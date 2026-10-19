import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { storySummary, personalizeStory } from './stories.mjs';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const requireThat = (ok, message, status = 400) => { if (!ok) throw new GameError(message, status); };
const token = () => randomBytes(32).toString('base64url');
export const STAGES = ['lobby', 'dossier', 'opening', 'search1', 'search2', 'confrontation', 'vote', 'ended'];
const STAGE_TITLES = { lobby: '等朋友入席', dossier: '阅读秘密档案', opening: '命案发生', search1: '第一轮 · 谁在撒谎', search2: '第二轮 · 核对时间', confrontation: '最后对质', vote: '秘密指认', ended: '真相揭晓', aborted: '本局已中止' };
const publicEvidence = (e) => ({ id: e.id, title: e.title, text: e.text, round: e.round, locationId: e.locationId, question: e.question });
const activeDiscussion = (r) => ['search1', 'search2', 'confrontation'].includes(r.stage);
const screenLed = room => room.playMode === 'screen-led';
const conversation = room => screenLed(room) && room.flowVersion === 2;
export const stagesFor = room => conversation(room) ? ['lobby', 'opening', 'dossier', 'search1', 'search2', 'vote', 'ended'] : screenLed(room) ? ['lobby', 'opening', 'dossier', 'search1', 'search2', 'confrontation', 'vote', 'ended'] : STAGES;

export function createRoom(storyId, { demo = false, code = String(randomInt(100000, 1000000)), playMode = 'classic', flowVersion = 1 } = {}) {
  return { code, storyId, demo, playMode, flowVersion, cardsReleased: false, hostToken: token(), stage: 'lobby', stageId: 1, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), players: [], published: [], citations: [], statements: [], hintLevel: 0, hintPending: false, hintApprovals: [], result: null, history: [] };
}
export function joinRoom(room, story, nickname, { internalDemo = false } = {}) {
  requireThat(!room.demo || internalDemo, '这是单人试玩房，不能加入真实玩家。');
  requireThat(room.stage === 'lobby', '本局已经开始，不能加入新玩家。', 409);
  requireThat(typeof nickname === 'string' && nickname.trim().length >= 1 && nickname.trim().length <= 12 && !/[\x00-\x1f]/.test(nickname), '昵称请填写1～12个字。');
  requireThat(room.players.length < story.players, '房间已满。', 409);
  requireThat(!room.players.some(p => p.nickname === nickname.trim()), '昵称已有人使用，请换一个。', 409);
  const player = { id: randomUUID(), token: token(), nickname: nickname.trim(), roleId: null, ready: false, searches: {}, evidenceIds: [], ballot: null, spoke: false };
  room.players.push(player); touch(room); return player;
}
export function authenticate(room, credential) {
  requireThat(typeof credential === 'string' && credential.length >= 32, '身份凭证无效，请从原来的浏览器进入。', 401);
  if (credential === room.hostToken) return { host: true, player: null };
  const player = room.players.find(p => p.token === credential);
  requireThat(player, '身份凭证已失效，请重新加入。', 401);
  return { host: false, player };
}
function touch(room) { room.revision++; room.updatedAt = Date.now(); }
function clearReady(room) { room.players.forEach(p => { p.ready = false; }); }
function record(room, kind, detail = {}) { room.history.push({ stage: room.stage, kind, ...detail }); if (room.history.length > 1000) room.history.shift(); }
function publish(room, id) {
  if (room.published.includes(id)) return false;
  room.published.push(id); clearReady(room); record(room, 'publish', { evidenceId: id }); return true;
}
function nextStage(room, story) {
  if (room.stage === 'search1' || room.stage === 'search2') for (const p of room.players) for (const id of p.evidenceIds) publish(room, id);
  const stages = stagesFor(room), index = stages.indexOf(room.stage);
  room.stage = stages[index + 1]; room.stageId++; clearReady(room);
  if (screenLed(room) && room.stage === 'dossier') room.cardsReleased = true;
  if (conversation(room) && ['search1', 'search2'].includes(room.stage)) {
    const round = room.stage === 'search1' ? 1 : 2;
    for (const e of story.evidence.filter(e => e.round === round)) publish(room, e.id);
  }
  room.hintPending = false; room.hintApprovals = [];
  record(room, 'stage');
  if (room.stage === 'ended') room.result = judge(room, story);
}
function resetGame(room, story) {
  room.stage = 'lobby'; room.stageId++; room.published = []; room.citations = []; room.statements = [];
  room.playMode = story.playMode || 'classic'; room.flowVersion = story.flowVersion || 1; room.cardsReleased = false;
  room.verified = [];
  room.hintLevel = 0; room.hintPending = false; room.hintApprovals = []; room.result = null; room.history = [];
  for (const p of room.players) Object.assign(p, { roleId: null, ready: false, searches: {}, evidenceIds: [], ballot: null, spoke: false });
}
function screenAction(room, story, data) {
  if (conversation(room) && ['screen_search', 'screen_supplement', 'screen_speak'].includes(data.kind)) throw new GameError('本局自由交谈，无需登记调查或发言。', 409);
  const player = () => { const p = room.players.find(p => p.id === data.playerId); requireThat(p, '请选择本局玩家。'); return p; };
  if (data.kind === 'screen_next') {
    requireThat(['opening', 'dossier', 'search1', 'search2', 'confrontation'].includes(room.stage), '当前不能推进阶段。', 409);
    if (!conversation(room) && ['search1', 'search2'].includes(room.stage)) {
      const round = room.stage === 'search1' ? 1 : 2;
      requireThat(room.players.every(p => p.searches[round]), '先登记每个人本轮调查的地点。', 409);
    }
    if (!conversation(room) && room.stage === 'confrontation') requireThat(room.players.every(p => p.spoke), '先让每人提问、陈述或明确放弃，并登记完成。', 409);
    nextStage(room, story);
  } else if (data.kind === 'screen_verify') {
    requireThat(conversation(room) && activeDiscussion(room), '讨论期间才能核对原件。', 409);
    const e = story.evidence.find(e => e.id === data.evidenceId);
    requireThat(e?.verification && room.published.includes(e.id), '只能核对已经公开的物证。', 409);
    room.verified ||= [];
    if (!room.verified.includes(e.id)) { room.verified.push(e.id); record(room, 'verify', { evidenceId: e.id }); }
  } else if (data.kind === 'screen_search') {
    requireThat(['search1', 'search2'].includes(room.stage), '当前不在调查阶段。', 409);
    const p = player(), round = room.stage === 'search1' ? 1 : 2;
    const found = story.evidence.find(e => e.locationId === data.locationId && e.round === round);
    requireThat(found, '这个调查地点不存在。');
    requireThat(!p.searches[round] || p.searches[round] === data.locationId, '这位玩家本轮已调查，最后对质时可以补查。', 409);
    if (!p.searches[round]) {
      p.searches[round] = data.locationId; p.evidenceIds.push(found.id);
      record(room, 'search', { playerId: p.id, locationId: data.locationId, round }); publish(room, found.id);
    }
  } else if (data.kind === 'screen_supplement') {
    requireThat(room.stage === 'confrontation', '最后对质时可以补查。', 409);
    requireThat(story.evidence.some(e => e.id === data.evidenceId), '证据不存在。');
    publish(room, data.evidenceId);
  } else if (data.kind === 'screen_speak') {
    requireThat(room.stage === 'confrontation', '当前不在对质阶段。', 409);
    requireThat(typeof data.value === 'boolean', '发言状态无效。'); player().spoke = data.value;
  } else if (data.kind === 'screen_hint') {
    requireThat(activeDiscussion(room), '讨论期间才能展开提示。', 409);
    requireThat(data.agreed === true, '请先取得全桌口头同意。');
    requireThat(room.hintLevel < story.hints.length, '提示已经全部展开。', 409);
    room.hintLevel++; record(room, 'hint');
  } else if (data.kind === 'screen_votes') {
    requireThat(room.stage === 'vote', '当前不能录入选票。', 409);
    requireThat(data.revealed === true, '请先收齐并同时揭开全部纸票。');
    const ballots = data.ballots;
    requireThat(Array.isArray(ballots) && ballots.length === story.players, '请一次录入全体玩家的纸票。');
    requireThat(new Set(ballots.map(b => b?.playerId)).size === story.players, '每位玩家只能录入一张选票。');
    requireThat(ballots.every(b => b && room.players.some(p => p.id === b.playerId) && story.roles.some(r => r.id === b.suspectId) && (conversation(room) || story.reasonOptions.some(r => r.id === b.reasonId))), '请完整选择每张选票的玩家和嫌疑人。');
    // 全部校验成功后才写入，错误的最后一张票也不会留下部分选票。
    for (const b of ballots) room.players.find(p => p.id === b.playerId).ballot = conversation(room) ? { suspectId: b.suspectId } : { suspectId: b.suspectId, reasonId: b.reasonId, testify: false };
    nextStage(room, story);
  } else throw new GameError('本局由公共屏主持，请使用公共屏的阶段操作。', 409);
}
export function act(room, story, credential, data) {
  const { host, player } = authenticate(room, credential);
  requireThat(data && !Array.isArray(data) && Number.isInteger(data.stageId) && data.stageId === room.stageId, '阶段已变化，请查看更新后的页面再操作。', 409);
  const kind = data.kind;
  requireThat(typeof kind === 'string', '缺少有效操作。');
  if (screenLed(room) && !['start', 'reset', 'abort', 'remove'].includes(kind)) {
    requireThat(host, '本局手机只提供私人角色卡与提示，操作由公共屏完成。', 403);
    screenAction(room, story, data); touch(room); return;
  }
  if (['start', 'reset', 'abort', 'remove'].includes(kind)) {
    requireThat(host, '只有公共屏可以执行此操作。', 403);
    if (kind === 'start') {
      requireThat(room.stage === 'lobby' && room.players.length === story.players, `需要${story.players}位玩家全部入席后才能开始。`, 409);
      const roles = [...story.roles];
      for (let i = roles.length - 1; i > 0; i--) { const j = randomInt(i + 1); [roles[i], roles[j]] = [roles[j], roles[i]]; }
      room.players.forEach((p, i) => { p.roleId = roles[i].id; });
      nextStage(room, story);
    } else if (kind === 'reset') {
      requireThat(['ended', 'aborted'].includes(room.stage), '请先结束或明确中止本局。', 409); resetGame(room, story);
    } else if (kind === 'abort') {
      requireThat(!['lobby', 'ended', 'aborted'].includes(room.stage), '当前没有可中止的对局。', 409);
      room.stage = 'aborted'; room.stageId++; clearReady(room); room.result = null;
    } else {
      requireThat(room.stage === 'lobby', '只能在大厅移除席位。', 409);
      requireThat(room.players.some(p => p.id === data.playerId), '没有找到这个席位。');
      room.players = room.players.filter(p => p.id !== data.playerId);
    }
  } else if (kind === 'hint_request') {
    requireThat(activeDiscussion(room), '讨论期间才能申请提示。', 409);
    requireThat(room.hintLevel < story.hints.length && !room.hintPending, '提示已经申请或全部展开。', 409);
    room.hintPending = true; room.hintApprovals = [];
  } else {
    requireThat(player, '公共屏不能代替玩家阅读、调查或投票。', 403);
    if (kind === 'ready') {
      requireThat(['dossier', 'opening', 'search1', 'search2', 'confrontation'].includes(room.stage), '现在不需要确认阅读。', 409);
      requireThat(typeof data.value === 'boolean', '完成状态必须为是或否。');
      if (['search1', 'search2'].includes(room.stage)) requireThat(player.searches[room.stage === 'search1' ? '1' : '2'], '请先调查一个地点，再完成本轮讨论。', 409);
      if (room.stage === 'confrontation') requireThat(player.spoke, '先完成自己的提问或陈述，也可以选择放弃发言。', 409);
      player.ready = data.value;
      if (room.players.every(p => p.ready)) nextStage(room, story);
    } else if (kind === 'search') {
      requireThat(['search1', 'search2'].includes(room.stage), '当前不在搜证阶段。', 409);
      const round = room.stage === 'search1' ? 1 : 2;
      const found = story.evidence.find(e => e.locationId === data.locationId && e.round === round);
      requireThat(found, '这个调查地点不存在。');
      const previous = player.searches[round];
      requireThat(!previous || previous === data.locationId, '本轮已经调查过，最后对质时可以补查遗漏。', 409);
      if (!previous) {
        player.searches[round] = data.locationId; player.evidenceIds.push(found.id);
        record(room, 'search', { playerId: player.id, locationId: data.locationId, round });
      }
    } else if (kind === 'publish' || kind === 'cite') {
      requireThat(activeDiscussion(room), '讨论期间才能公开或引用证据。', 409);
      requireThat(player.evidenceIds.includes(data.evidenceId) || room.published.includes(data.evidenceId), '你还没有取得这份证据。', 403);
      const evidence = story.evidence.find(e => e.id === data.evidenceId);
      requireThat(evidence, '证据不存在。');
      if (kind === 'cite') {
        requireThat(room.players.some(p => p.id === data.targetId), '请选择要询问的玩家。');
        requireThat(room.citations.length < 60, '提问记录已满，请继续口头讨论。');
      }
      publish(room, evidence.id);
      if (kind === 'cite') {
        room.citations.push({ playerId: player.id, targetId: data.targetId, evidenceId: evidence.id, text: evidence.question });
      }
    } else if (kind === 'supplement') {
      requireThat(room.stage === 'confrontation', '最后对质时可以补查。', 409);
      const found = story.evidence.find(e => e.id === data.evidenceId);
      requireThat(found, '证据不存在。');
      publish(room, found.id);
      if (!player.evidenceIds.includes(found.id)) player.evidenceIds.push(found.id);
    } else if (kind === 'speak') {
      requireThat(room.stage === 'confrontation', '当前不在对质阶段。', 409);
      player.spoke = true;
    } else if (kind === 'statement') {
      requireThat(activeDiscussion(room), '讨论期间才能记录说法。', 409);
      requireThat(typeof data.text === 'string' && data.text.trim().length > 0 && data.text.length <= 160, '人物说法请写1～160字。');
      requireThat(room.statements.length < 60, '记录已满，请继续口头讨论。');
      room.statements.push({ playerId: player.id, text: data.text.trim() });
    } else if (kind === 'hint_approve') {
      requireThat(room.hintPending && activeDiscussion(room), '没有正在申请的提示。', 409);
      if (!room.hintApprovals.includes(player.id)) room.hintApprovals.push(player.id);
      if (room.hintApprovals.length === room.players.length) {
        room.hintLevel++; room.hintPending = false; room.hintApprovals = []; clearReady(room);
      }
    } else if (kind === 'vote') {
      requireThat(room.stage === 'vote', '当前不能投票。', 409);
      requireThat(story.roles.some(r => r.id === data.suspectId) && story.reasonOptions.some(r => r.id === data.reasonId) && typeof data.testify === 'boolean', '请完整选择嫌疑人、关键判断和是否提交证词。');
      player.ballot = { suspectId: data.suspectId, reasonId: data.reasonId, testify: data.testify };
      if (room.players.every(p => p.ballot)) nextStage(room, story);
    } else throw new GameError('不支持的操作。');
  }
  touch(room);
}

export function judge(room, story) {
  const majority = Math.floor(story.players / 2) + 1;
  const counts = Object.fromEntries(story.roles.map(r => [r.id, 0]));
  let completeVotes = 0;
  for (const p of room.players) {
    counts[p.ballot.suspectId]++;
    if (p.ballot.suspectId === story.answer.culpritId && (conversation(room) || p.ballot.reasonId === story.answer.reasonId)) completeVotes++;
  }
  const majorityId = Object.keys(counts).find(id => counts[id] >= majority);
  let title, key;
  if (completeVotes >= majority) { key = 'solved'; title = '正确指认'; }
  else if (majorityId === story.answer.culpritId) { key = 'partial'; title = '认对人，过程未还原'; }
  else if (majorityId) { key = 'wrong'; title = '错误指认'; }
  else { key = 'divided'; title = '意见未合'; }
  return { key, title, majority, completeVotes, counts, answer: conversation(room) ? { culpritId: story.answer.culpritId } : { ...story.answer }, players: room.players.map(p => {
    const role = story.roles.find(r => r.id === p.roleId);
    const named = p.ballot.suspectId === story.answer.culpritId;
    const correct = named && (conversation(room) || p.ballot.reasonId === story.answer.reasonId);
    const message = role.isCulprit ? (completeVotes >= majority ? '你的掩饰被多数人识破。' : '你的身份未获得全桌多数的正确指认。') : correct ? (conversation(room) ? '你找出了凶手。一起说说哪条发现改变了你的判断。' : '你正确还原了本案。') : named ? '你认对了人，但关键判断有误。请对照复盘中的原始证据。' : '你的指认与完整证据链不符。请对照复盘核对案发经过与人物行踪。';
    return { playerId: p.id, nickname: p.nickname, roleId: role.id, name: role.name, isCulprit: role.isCulprit, ballot: { ...p.ballot }, message, testimony: p.ballot.testify ? role.testimony : null, dossier: role.dossier };
  }) };
}

export function snapshot(room, story, credential, isOnline = () => false) {
  const { host, player } = authenticate(room, credential);
  // 先在服务端按本局角色分配填入昵称，再按凭证投影，整份故事不会发给浏览器。
  story = personalizeStory(story, room.players);
  const started = room.stage !== 'lobby';
  const ended = room.stage === 'ended';
  const currentRound = room.stage === 'search1' ? 1 : room.stage === 'search2' ? 2 : null;
  if (screenLed(room) && !host) {
    const role = room.cardsReleased && story.roles.find(r => r.id === player.roleId);
    return structuredClone({ host: false, public: {
      code: room.code, demo: room.demo, playMode: 'screen-led', flowVersion: room.flowVersion || 1, stage: room.stage, stageId: room.stageId, revision: room.revision,
      story: { id: story.id, title: story.title, players: story.players }, title: STAGE_TITLES[room.stage],
    }, me: { id: player.id, nickname: player.nickname,
      role: role ? { id: role.id, name: role.name, brief: role.brief, isCulprit: role.isCulprit, card: conversation(room) ? { goal: role.actionCard.goal, facts: role.actionCard.facts, history: role.actionCard.history, boundaries: role.actionCard.boundaries, starter: role.actionCard.starter } : { ...role.actionCard, focus: role.actionCard.focus[room.stage] || '本局已中止，可保留自己的角色卡。' } } : null,
      responseHints: role && !conversation(room) ? room.published.map(id => story.evidence.find(e => e.id === id)).filter(e => e.screenHints?.[role.id]).map(e => ({ id: e.id, title: e.title, direction: e.screenHints[role.id] })) : [],
    } });
  }
  const publicView = {
    code: room.code, demo: room.demo, playMode: room.playMode || 'classic', flowVersion: room.flowVersion || 1, stageOrder: stagesFor(room), story: storySummary(story), stage: room.stage, stageId: room.stageId, revision: room.revision,
    title: (conversation(room) ? { dossier: '先认识彼此', search1: '第一批发现', search2: '新的发现', vote: '你怀疑谁' }[room.stage] : null) || STAGE_TITLES[room.stage], instruction: (conversation(room) ? story.conversation.notes[room.stage] : screenLed(room) ? story.screenNotes?.[room.stage] : story.stageNotes[room.stage]) || (room.stage === 'lobby' ? `等待${story.players}位朋友加入，公共屏不会收到私人角色。` : '本局未完成，不判胜负。可以回到大厅。'),
    ...(conversation(room) && started ? { discussion: story.conversation.beats[room.stage] || null } : {}),
    ...(screenLed(room) && started ? { briefing: story.briefing } : {}),
    players: room.players.map(p => { const r = story.roles.find(r => r.id === p.roleId); return { id: p.id, nickname: p.nickname, online: isOnline(p.token), ready: p.ready, searched: currentRound ? Boolean(p.searches[currentRound]) : false, locationId: currentRound ? p.searches[currentRound] || null : null, voted: Boolean(p.ballot), spoke: p.spoke, role: started && r ? { id: r.id, name: r.name, brief: r.brief, intro: r.intro } : null }; }),
    opening: started ? (screenLed(room) ? story.briefing.scene : story.opening) : null, rules: started ? (screenLed(room) ? story.briefing.rules : story.rules) : [], anchors: started ? story.anchors : [], locations: started ? story.locations : [],
    evidence: room.published.map(id => {
      const original = story.evidence.find(e => e.id === id), e = publicEvidence(original);
      if (conversation(room)) {
        delete e.question;
        e.canVerify = Boolean(original.verification);
        if (room.verified?.includes(id)) e.verification = original.verification;
      }
      return e;
    }),
    // 对质阶段仅列目录；正文必须通过补查后进入公共板。
    missing: room.stage === 'confrontation' ? story.evidence.filter(e => !room.published.includes(e.id)).map(e => ({ id: e.id, title: e.title, round: e.round, locationId: e.locationId })) : [],
    citations: room.citations.map(c => ({ ...c, text: story.evidence.find(e => e.id === c.evidenceId).question })), statements: room.statements,
    hints: story.hints.slice(0, room.hintLevel), hintLimit: story.hints.length, hintPending: room.hintPending, hintApprovedCount: room.hintApprovals.length,
    reasonOptions: !conversation(room) && ['vote', 'ended'].includes(room.stage) ? story.reasonOptions : [],
    result: ended ? { ...room.result, players: room.result.players.map(p => {
      const role = story.roles.find(r => r.id === p.roleId);
      return { ...p, name: role.name, brief: role.brief, dossier: screenLed(room) ? [{ label: '本局目的', text: role.actionCard.goal }, ...role.actionCard.history] : role.dossier, testimony: !screenLed(room) && p.ballot.testify ? role.testimony : null };
    }) } : null, replay: ended ? (screenLed(room) ? story.screenReplay : story.replay) : [], timeline: ended ? story.timeline : [],
  };
  const r = player && story.roles.find(r => r.id === player.roleId);
  const me = player ? { id: player.id, nickname: player.nickname, ready: player.ready, spoke: player.spoke, searches: player.searches, ballot: player.ballot, hintApproved: room.hintApprovals.includes(player.id), role: r ? { id: r.id, name: r.name, brief: r.brief, intro: r.intro, isCulprit: r.isCulprit, dossier: r.dossier, testimony: r.testimony } : null, evidence: player.evidenceIds.map(id => { const e = story.evidence.find(x => x.id === id); return { ...publicEvidence(e), hint: e.hints[player.roleId] || '对照你知道的经历。这份物证能证明什么，哪些还只是推断？' }; }) } : null;
  // 副本确保序列化前后都不存在共享内部引用。
  return structuredClone({ host, public: publicView, me });
}
