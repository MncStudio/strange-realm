import type { ActionRequest, Ending, LogEntry, Phase, PrivateSnapshot, PublicSnapshot, ReplayEntry, RoundReport, PresentationCue } from '@strange-realm/shared';
import { SeededRandom } from './random';
import type { EnginePlayer, EvaluationContext, EventDefinition, RoundContext, ScenarioDefinition, WorldState } from './types';
export type * from './types';
export { SeededRandom } from './random';
export function matchesEvent(event: EventDefinition, ctx: EvaluationContext): boolean {
  return ctx.round >= event.minRound && ctx.round <= event.maxRound &&
    (event.requiresFacts ?? []).every(fact => ctx.world.facts.has(fact)) &&
    (event.absentFacts ?? []).every(fact => !ctx.world.facts.has(fact));
}
/** Lifecycle and projection are generic; narrative, identity and infection belong to scenarios. */
export class GameEngine {
  private _phase: Phase = 'lobby';
  private stageId = 0;
  private round = 0;
  private players = new Map<string, EnginePlayer>();
  private world: WorldState;
  private rng: SeededRandom;
  private event: EventDefinition | null = null;
  private used = new Set<string>();
  private actions = new Map<string, ActionRequest>();
  private reads = new Set<string>();
  private presentationDone = false;
  private cues: PresentationCue[] = [];
  private logs: LogEntry[] = [];
  private privateLogs = new Map<string, LogEntry[]>();
  private replay: ReplayEntry[] = [];
  private ending: Ending | null = null;
  private report: RoundReport | null = null;
  constructor(private readonly scenario: ScenarioDefinition, seed: string) {
    if (!scenario.events.length || !Number.isInteger(scenario.maxRounds) || scenario.maxRounds < 1) throw new Error('剧本缺少合法事件回合');
    this.rng = new SeededRandom(seed); this.world = this.freshWorld();
  }
  get phase(): Phase { return this._phase; }
  get playerCount(): number { return this.players.size; }
  get allSubmitted(): boolean { return this.players.size > 0 && this.actions.size === this.players.size; }
  private freshWorld(): WorldState { return { facts: new Set(), values: { ...this.scenario.initialWorld } }; }
  private context(): EvaluationContext { return { world: this.world, players: this.players, round: this.round, maxRounds: this.scenario.maxRounds, event: this.event }; }
  private player(id: string): EnginePlayer { const value = this.players.get(id); if (!value) throw new Error('玩家不存在'); return value; }
  private checkStage(stageId: number): void { if (stageId !== this.stageId) throw new Error('阶段已失效，请同步当前状态'); }
  private enter(phase: Phase, cues: PresentationCue[] = []): void {
    this._phase = phase; this.stageId++; this.reads.clear(); this.cues = structuredClone(cues); this.presentationDone = !cues.length;
  }
  addPlayer(id: string, nickname: string): void {
    if (this.phase !== 'lobby') throw new Error('游戏已开始，不能加入');
    if (this.players.has(id)) throw new Error('玩家已在房间中');
    if (this.playerCount >= this.scenario.summary.maxPlayers) throw new Error('房间已满');
    const name = nickname.trim(); if (!name || name.length > 16) throw new Error('昵称应为1～16个字符');
    this.players.set(id, { id, nickname: name, connected: true, ready: false, state: {}, instruction: null,
      knowledge: { identity: { kind: 'ordinary', label: '普通访客', explanation: '你和朋友一起来到旅馆。没有预先分配的敌人。' }, symptoms: [], clues: [] } });
    this.privateLogs.set(id, []);
  }
  removePlayer(id: string): void { if (this.phase !== 'lobby') { this.setConnected(id, false); return; } this.players.delete(id); this.privateLogs.delete(id); }
  setConnected(id: string, connected: boolean): void { this.player(id).connected = connected; }
  setReady(id: string, ready: boolean): void { if (this.phase !== 'lobby') throw new Error('只能在大厅切换准备状态'); this.player(id).ready = ready; }
  start(_now?: number): void {
    if (this.phase !== 'lobby') throw new Error('游戏已经开始');
    if (this.playerCount < this.scenario.summary.minPlayers) throw new Error(`需要${this.scenario.summary.minPlayers}～${this.scenario.summary.maxPlayers}名玩家`);
    if ([...this.players.values()].some(player => !player.connected || !player.ready)) throw new Error('所有玩家连接并准备后才能开始');
    this.scenario.initialize(this.context(), this.rng); this.enter('introduction', this.scenario.introCues);
    this.logs.push({ round: 0, title: '登记完成', text: '所有人都是普通访客。共同寻找出口，别把异常带出去。' });
  }
  markPresentationDone(stageId: number): void {
    this.checkStage(stageId);
    if (!['introduction', 'event', 'resolution'].includes(this.phase)) throw new Error('当前没有公共演出');
    this.presentationDone = true; this.maybeContinue();
  }
  advance(stageId: number): void {
    this.checkStage(stageId);
    if (!this.presentationDone) throw new Error('请先完成或跳过公共演出');
    if (this.phase === 'introduction') this.beginRound();
    else if (this.phase === 'event') { this.scenario.createInstructions(this.context(), this.rng); this.enter('action'); }
    else throw new Error('须等待所有玩家提交或确认已读，主持不能跳过在线玩家');
  }
  private beginRound(): void {
    this.round++; this.actions.clear(); this.report = null;
    for (const player of this.players.values()) player.instruction = null;
    const eligible = this.scenario.events.filter(event => !this.used.has(event.id) && matchesEvent(event, this.context()));
    if (!eligible.length) throw new Error('剧本没有符合当前历史的事件');
    const priority = Math.max(...eligible.map(event => event.priority));
    const pool = eligible.filter(event => event.priority === priority).sort((a, b) => a.id.localeCompare(b.id));
    let weight = this.rng.next() * pool.reduce((total, event) => total + (event.weight ?? 1), 0);
    this.event = pool.find(event => { weight -= event.weight ?? 1; return weight < 0; }) ?? pool.at(-1)!;
    this.used.add(this.event.id); this.enter('event', this.event.cues);
    this.logs.push({ round: this.round, title: this.event.title, text: this.event.narrative });
  }
  submitAction(id: string, request: ActionRequest): void {
    this.checkStage(request.stageId); if (this.phase !== 'action') throw new Error('当前不是行动阶段');
    const player = this.player(id); if (this.actions.has(id)) throw new Error('已经提交，不能更改');
    const definition = this.scenario.getActions(this.context(), player).find(action => action.id === request.actionId);
    if (!definition) throw new Error('本事件没有这个行动');
    if (definition.targetMode === 'player') {
      if (!request.targetId || !this.players.has(request.targetId) || request.targetId === id) throw new Error('请选择其他有效玩家');
    } else if (request.targetId !== undefined) throw new Error('该行动不接受目标');
    this.actions.set(id, { stageId: request.stageId, actionId: request.actionId, ...(request.targetId ? { targetId: request.targetId } : {}) });
  }
  acknowledgeRead(id: string, stageId: number): void {
    this.checkStage(stageId); this.player(id);
    if (this.phase !== 'resolution' || !this.presentationDone) throw new Error('请先观看本轮公共后果');
    this.reads.add(id); this.maybeContinue();
  }
  private maybeContinue(): void {
    if (this.phase !== 'resolution' || !this.presentationDone || this.reads.size !== this.playerCount) return;
    if (this.ending) this.enter('ended'); else this.beginRound();
  }
  fillDisconnectedActions(stageId: number): void {
    this.checkStage(stageId);
    if (this.phase !== 'action' && this.phase !== 'resolution') throw new Error('当前不能代替离线玩家');
    if (this.phase === 'resolution' && !this.presentationDone) throw new Error('请先完成公共演出');
    for (const player of this.players.values()) if (!player.connected) {
      if (this.phase === 'action' && !this.actions.has(player.id)) this.submitAction(player.id, { stageId, actionId: this.event!.defaultActionId });
      else if (this.phase === 'resolution') this.reads.add(player.id);
    }
    this.maybeContinue();
  }
  tick(_now?: number): void { if (this.phase === 'action' && this.allSubmitted) this.resolve(); }
  private resolve(): void {
    if (!this.event) throw new Error('当前事件不存在');
    const effects = new Map<string, string[]>(); const consequences: string[] = []; const causes: ReplayEntry['causes'] = [];
    const ctx: RoundContext = { ...this.context(), event: this.event, actions: this.actions, rng: this.rng,
      orderedPlayers: this.rng.shuffle([...this.players.values()].sort((a, b) => a.id.localeCompare(b.id))),
      privateResult: (id, text) => effects.set(id, [...(effects.get(id) ?? []), text]),
      publicResult: (title, text) => { consequences.push(`${title}：${text}`); this.logs.push({ round: this.round, title, text }); },
      audit: (title, detail, id) => causes.push({ title, detail, ...(id ? { nickname: this.player(id).nickname } : {}) }),
      clue: (id, text) => { const list = this.player(id).knowledge.clues; if (!list.includes(text)) list.push(text); }
    };
    this.scenario.resolveRound(ctx);
    const actions = [...this.players.values()].sort((a, b) => a.id.localeCompare(b.id)).map(player => {
      const request = this.actions.get(player.id)!;
      const label = this.scenario.getActions(this.context(), player).find(action => action.id === request.actionId)?.label ?? this.event!.actions.find(action => action.id === request.actionId)?.label ?? request.actionId;
      const text = (effects.get(player.id) ?? ['你的选择已结算。']).join(' ');
      this.privateLogs.get(player.id)!.push({ round: this.round, title: label, text });
      return { nickname: player.nickname, action: label + (request.targetId ? ` → ${this.player(request.targetId).nickname}` : ''), result: text };
    });
    this.replay.push({ round: this.round, event: this.event.title, actions, causes, consequences });
    const definition = this.scenario.evaluateEnding(this.context(), this.round >= this.scenario.maxRounds);
    if (definition) this.ending = { ...definition, outcomes: [...this.players.values()].map(player => ({ playerId: player.id, nickname: player.nickname, ...this.scenario.evaluatePlayer(this.context(), player) })) };
    this.report = { round: this.round, event: this.event.title, summary: '选择已经发生。先看公共后果，再看手机上的本人结果。', consequences,
      nextStep: this.ending ? '本局的命运已经决定。全员读完后，揭晓真实身份与关键选择。' : this.scenario.describeSituation(this.context()), endingPending: !!this.ending };
    const cues = this.scenario.resultCues?.(this.context(), consequences) ?? [{ id: 'result', kind: 'text' as const, text: consequences.join('\n') || '旅馆暂时安静下来。', durationMs: 1000 }];
    this.enter('resolution', cues);
  }
  reset(seed: string): void {
    if (this.phase !== 'ended' && this.phase !== 'lobby') throw new Error('请等本局结束');
    this.rng = new SeededRandom(seed); this.world = this.freshWorld(); this.round = 0;
    this.event = null; this.used.clear(); this.actions.clear(); this.logs = []; this.replay = []; this.ending = null; this.report = null;
    for (const player of this.players.values()) { player.ready = false; player.state = {}; player.instruction = null;
      player.knowledge = { identity: { kind: 'ordinary', label: '普通访客', explanation: '你和朋友一起来到旅馆。' }, symptoms: [], clues: [] }; this.privateLogs.set(player.id, []); }
    this.enter('lobby');
  }
  getPublicSnapshot(roomId: string, code: string, now: number): PublicSnapshot {
    return { roomId, code, scenario: { ...this.scenario.summary }, phase: this.phase, stageId: this.stageId, round: this.round, maxRounds: this.scenario.maxRounds, serverNow: now,
      players: [...this.players.values()].map(player => ({ id: player.id, nickname: player.nickname, connected: player.connected, ready: player.ready, submitted: this.actions.has(player.id), read: this.reads.has(player.id) })),
      submittedCount: this.actions.size, readCount: this.reads.size, intro: this.scenario.intro, goal: this.scenario.goal,
      facts: [...this.world.facts].flatMap(fact => this.scenario.factLabels[fact] ? [this.scenario.factLabels[fact]!] : []),
      publicRules: [...this.scenario.publicRules], event: this.event ? { id: this.event.id, title: this.event.title, narrative: this.event.narrative, dilemma: this.event.dilemma, hint: this.event.hint } : null,
      cues: structuredClone(this.cues), presentationDone: this.presentationDone, log: structuredClone(this.logs), roundReport: structuredClone(this.report),
      ending: this.phase === 'ended' ? structuredClone(this.ending) : null, replay: this.phase === 'ended' ? structuredClone(this.replay) : [] };
  }
  getPrivateSnapshot(id: string): PrivateSnapshot {
    const player = this.player(id);
    return { playerId: id, identity: structuredClone(player.knowledge.identity), instruction: player.instruction ? structuredClone(player.instruction.view) : null,
      actions: this.phase === 'action' ? structuredClone(this.scenario.getActions(this.context(), player)) : [], submittedAction: this.actions.has(id) ? { ...this.actions.get(id)! } : null,
      symptoms: [...player.knowledge.symptoms], clues: [...player.knowledge.clues], results: structuredClone(this.privateLogs.get(id)!),
      outcome: this.phase === 'ended' ? structuredClone(this.ending?.outcomes.find(value => value.playerId === id) ?? null) : null };
  }
}
