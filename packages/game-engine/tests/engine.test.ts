import { describe, expect, it } from 'vitest';
import { GameEngine, SeededRandom, matchesEvent } from '../src';
import type { EnginePlayer, EvaluationContext, RoundContext, ScenarioDefinition, WorldState } from '../src';
import type { ActionRequest } from '@strange-realm/shared';
import { cooperationPlan } from '../../../apps/web/src/demo/cooperate';
import { getScenario, validateScenario } from '../../scenarios/src';
const scenario = getScenario('seventh-visitor');
const ids = ['p0','p1','p2','p3'];
const pub = (game: GameEngine) => game.getPublicSnapshot('test', 'ABCDEF', 0);
function make(seed = 'test', definition = scenario, count = 4) {
  const game = new GameEngine(definition, seed);
  for(let i=0;i<count;i++) { game.addPlayer(`p${i}`, `访客${i}`); game.setReady(`p${i}`, true); }
  game.start(); return game;
}
function actionPhase(game: GameEngine) {
  let s = pub(game);
  if (s.phase === 'introduction') { game.markPresentationDone(s.stageId); game.advance(s.stageId); s = pub(game); }
  expect(s.phase).toBe('event'); game.markPresentationDone(s.stageId); game.advance(s.stageId); expect(game.phase).toBe('action');
}
function perform(game: GameEngine, requests: Record<string, Partial<ActionRequest>> = {}, reversed = false) {
  const s = pub(game); const list = s.players.map(player=>player.id); if(reversed) list.reverse();
  for(const id of list) game.submitAction(id, { stageId:s.stageId, actionId:game.getPrivateSnapshot(id).actions.find(action=>action.targetMode==='none')!.id,...requests[id] });
  game.tick(); expect(game.phase).toBe('resolution');
}
function read(game: GameEngine) { const s=pub(game); game.markPresentationDone(s.stageId); for(const player of s.players) game.acknowledgeRead(player.id,s.stageId); }
function player(id: string, n = 0): EnginePlayer { return { id, nickname:id, connected:true,ready:true,state:{exposure:n,helped:0,resisted:0,spread:0},instruction:null,knowledge:{identity:{kind:n===3?'changed':n===2?'awakened':'ordinary',label:'已知信息',explanation:'测试'},symptoms:[],clues:[]} }; }
function round(eventId:string, requests:Record<string,Partial<ActionRequest>>={}, levels:Record<string,number>={}, facts:string[]=[]) {
  const event=scenario.events.find(value=>value.id===eventId)!;
  const players=new Map(ids.map(id=>[id,player(id,levels[id] ?? 0)]));
  const world:WorldState={facts:new Set(facts),values:{purifications:2}};
  const actions=new Map(ids.map(id=>[id,{stageId:1,actionId:event.defaultActionId,...requests[id]}]));
  const results=new Map<string,string[]>(); const causes:string[]=[]; const consequences:string[]=[];
  const ctx:RoundContext={world,players,round:event.minRound,maxRounds:7,event,actions,rng:new SeededRandom('fixture'),orderedPlayers:[...players.values()],
    privateResult:(id,text)=>{results.set(id,[...(results.get(id)??[]),text]);}, publicResult:(title,text)=>{consequences.push(`${title}:${text}`);},audit:(title,text,id)=>{causes.push(`${id??''}:${title}:${text}`);},clue:(id,text)=>{players.get(id)!.knowledge.clues.push(text);} };
  return {ctx,results,causes,consequences};
}
function complete(seed: string, count=4) {
  let captured: Map<string,EnginePlayer>;
  const definition:ScenarioDefinition={...scenario,initialize:(ctx,rng)=>{scenario.initialize(ctx,rng);captured=ctx.players;}};
  const game=make(seed,definition,count);
  for(let r=1;r<=7;r++) {
    actionPhase(game); const s=pub(game); const requests:Record<string,Partial<ActionRequest>>={};
    const people=s.players.map(value=>value.id);
    let answer:string|undefined;
    if(r===2) answer=people.find(id=>game.getPrivateSnapshot(id).instruction?.title!=='门认得你');
    for(const id of people) {
      const p=game.getPrivateSnapshot(id); let actionId=p.actions.find(action=>action.targetMode==='none')!.id; let targetId:string|undefined;
      if(r===2) { actionId=id===answer?'answer_door':'inspect_knocks'; if(id===people.find(value=>value!==answer)){actionId='protect';targetId=answer;} }
      if(p.instruction?.title==='它不想你洗掉名字') {actionId='protect';targetId=people.find(value=>value!==id);}
      if(r===4 || r===6) { if(!p.instruction && p.actions.some(action=>action.id==='purify')) actionId=(p.actions.find(action=>['inspect_water','resist'].includes(action.id))?.id??actionId); }
      if(r===7) actionId='verify_leave';
      requests[id]={actionId,...(targetId?{targetId}:{})};
    }
    perform(game,requests); expect([...captured!.values()].every(value=>value.state.exposure===0)).toBe(true); read(game);
  }
  return game;
}
describe('通用阶段、普通人开局与网络投影',()=>{
  it('开局没有职业、背包和秘密阵营',()=>{ const game=make(); ids.forEach(id=>expect(game.getPrivateSnapshot(id).identity.kind).toBe('ordinary')); expect(JSON.stringify(pub(game))).not.toMatch(/role|inventory|exposure|instruction/); });
  it('任意等待不跳开场、事件、行动或结果',()=>{const game=make();game.tick(1e12);expect(game.phase).toBe('introduction'); actionPhase(game);game.tick(1e12);expect(game.phase).toBe('action');perform(game);game.markPresentationDone(pub(game).stageId);game.tick(1e12);expect(game.phase).toBe('resolution');});
  it('公共演出未完成不能进入选择',()=>{const game=make();expect(()=>game.advance(pub(game).stageId)).toThrow('演出');game.markPresentationDone(pub(game).stageId);game.advance(pub(game).stageId);expect(()=>game.advance(pub(game).stageId)).toThrow('演出');});
  it('只有全员提交才统一结算',()=>{const game=make();actionPhase(game);const stageId=pub(game).stageId;ids.slice(0,3).forEach(id=>game.submitAction(id,{stageId,actionId:'inspect_register'}));game.tick();expect(game.phase).toBe('action');game.submitAction(ids[3]!,{stageId,actionId:'inspect_register'});game.tick();expect(game.phase).toBe('resolution');});
  it('结果演出后全员已读自动推进一次，重复确认幂等',()=>{const game=make();actionPhase(game);perform(game);const s=pub(game);expect(()=>game.acknowledgeRead('p0',s.stageId)).toThrow('公共后果');game.markPresentationDone(s.stageId);ids.slice(0,3).forEach(id=>game.acknowledgeRead(id,s.stageId));game.acknowledgeRead('p0',s.stageId);expect(pub(game).readCount).toBe(3);expect(game.phase).toBe('resolution');game.acknowledgeRead('p3',s.stageId);expect(game.phase).toBe('event');expect(pub(game).round).toBe(2);expect(()=>game.acknowledgeRead('p3',s.stageId)).toThrow('失效');});
  it('主持不能强行跳过在线选择或已读',()=>{const game=make();actionPhase(game);expect(()=>game.advance(pub(game).stageId)).toThrow('不能跳过');perform(game);game.markPresentationDone(pub(game).stageId);expect(()=>game.advance(pub(game).stageId)).toThrow('不能跳过');});
  it('拒绝未知、过期、重复和伪造目标行动',()=>{const game=make();actionPhase(game);const stageId=pub(game).stageId;expect(()=>game.submitAction('p0',{stageId:stageId-1,actionId:'inspect_register'})).toThrow('失效');expect(()=>game.submitAction('p0',{stageId,actionId:'invented'})).toThrow('本事件');expect(()=>game.submitAction('p0',{stageId,actionId:'inspect_register',targetId:'p1'})).toThrow('不接受');game.submitAction('p0',{stageId,actionId:'inspect_register'});expect(()=>game.submitAction('p0',{stageId,actionId:'inspect_register'})).toThrow('已经提交');});
  it('人数、准备与阶段必须合法',()=>{const game=new GameEngine(scenario,'limits');expect(()=>game.start()).toThrow('4～6');for(let i=0;i<6;i++)game.addPlayer(`p${i}`,`人${i}`);expect(()=>game.addPlayer('extra','七')).toThrow('已满');expect(()=>game.start()).toThrow('准备');});
  it('明确离线代操作不能替在线玩家选择或已读',()=>{const game=make();actionPhase(game);let s=pub(game);game.fillDisconnectedActions(s.stageId);expect(pub(game).submittedCount).toBe(0);game.setConnected('p0',false);game.fillDisconnectedActions(s.stageId);expect(game.getPrivateSnapshot('p0').submittedAction!.actionId).toBe('resist');for(const id of ids.slice(1))game.submitAction(id,{stageId:s.stageId,actionId:'inspect_register'});game.tick();s=pub(game);game.markPresentationDone(s.stageId);game.fillDisconnectedActions(s.stageId);expect(pub(game).readCount).toBe(1);game.setConnected('p0',true);expect(game.getPrivateSnapshot('p0').submittedAction!.actionId).toBe('resist');});
  it('投影是副本，潜伏原始真相不发送给本人',()=>{const one=make('projection',{...scenario,initialize:(ctx,rng)=>{scenario.initialize(ctx,rng);ctx.players.get('p0')!.state.exposure=1;}});const zero=make('projection');actionPhase(one);actionPhase(zero);expect(one.getPrivateSnapshot('p0')).toEqual(zero.getPrivateSnapshot('p0'));expect(pub(one)).toEqual(pub(zero));const copy=one.getPrivateSnapshot('p0');copy.clues.push('伪造');expect(one.getPrivateSnapshot('p0').clues).not.toContain('伪造');expect(JSON.stringify(copy)).not.toContain('exposure');});
  it('发送顺序不改变裁决、指令和回执',()=>{const first=make('packets'),second=make('packets');actionPhase(first);actionPhase(second);const actions={p0:{actionId:'sign_register'},p1:{actionId:'inspect_register'},p2:{actionId:'sign_register'},p3:{actionId:'resist'}};perform(first,actions);perform(second,actions,true);expect(pub(first)).toEqual(pub(second));ids.forEach(id=>expect(first.getPrivateSnapshot(id)).toEqual(second.getPrivateSnapshot(id)));});
  it('不同种子产生不同合法事件组合',()=>{const signatures=new Set<string>();for(let i=0;i<12;i++){const game=complete(`variation${i}`);signatures.add(pub(game).replay.map(value=>value.event).join('|'));}expect(signatures.size).toBeGreaterThan(1);});
  it.each([4,5,6])('%s人零感染完整路径与最后结果确认后揭晓',count=>{const game=complete(`zero-${count}`,count);expect(game.phase).toBe('ended');expect(pub(game).ending!.id).toBe('safe-dawn');expect(pub(game).ending!.outcomes).toHaveLength(count);expect(pub(game).replay).toHaveLength(7);});
  it('事件变化、全员拒绝与混合选择均在七幕内结束，最后已读前不揭密',()=>{
    for(let seed=0;seed<20;seed++) {
      const game=make(`mixed-${seed}`); const rng=new SeededRandom(`choices-${seed}`);
      for(let r=1;r<=7;r++) {
        actionPhase(game); const requests:Record<string,Partial<ActionRequest>>={};
        for(const id of ids) {
          const options=game.getPrivateSnapshot(id).actions;
          expect(options.length).toBeGreaterThanOrEqual(2); expect(options.length).toBeLessThanOrEqual(3);
          const action=options[rng.int(options.length)]!;
          requests[id]={actionId:action.id,...(action.targetMode==='player'?{targetId:ids.find(other=>other!==id)}:{})};
        }
        perform(game,requests); expect(pub(game).replay).toEqual([]); expect(pub(game).ending).toBeNull();
        ids.forEach(id=>expect(game.getPrivateSnapshot(id).outcome).toBeNull()); read(game);
      }
      expect(game.phase).toBe('ended'); expect(pub(game).replay).toHaveLength(7);
    }
  });
  it('自动同伴受指令改变选择后不会夹带旧的护持目标',()=>{
    for(let seed=0;seed<20;seed++) {
      const game=make(`bot-target-${seed}`);actionPhase(game);perform(game,Object.fromEntries(ids.map(id=>[id,{actionId:'inspect_register'}])));read(game);actionPhase(game);
      const s=pub(game);game.submitAction('p0',{stageId:s.stageId,actionId:'answer_door'});
      const participants=ids.map(id=>({id,secret:game.getPrivateSnapshot(id),submitted:id==='p0'}));
      const plan=cooperationPlan(s,participants);
      for(const [id,request]of plan)expect(()=>game.submitAction(id,request)).not.toThrow();
      game.tick();expect(game.phase).toBe('resolution');
    }
  });
  it('最小二人剧本不需要职业、感染或旅馆指标',()=>{
    const event={ id:'arrive',title:'到站',narrative:'车停了',dilemma:'坐好还是敲窗',hint:'等待可以到站',minRound:1,maxRound:1,priority:1,tags:[],defaultActionId:'wait',cues:[],actions:[{id:'wait',label:'坐好',description:'等待到站',targetMode:'none' as const},{id:'knock',label:'敲窗',description:'提醒同伴',targetMode:'player' as const}] };
    const definition:ScenarioDefinition={
      summary:{id:'test-bus',title:'测试车',subtitle:'测试',synopsis:'测试',minPlayers:2,maxPlayers:2,estimatedMinutes:'一幕'},intro:'上车',goal:'到站',publicRules:[],introCues:[],maxRounds:1,initialWorld:{},factLabels:{arrived:'已到站'},events:[event],
      initialize:ctx=>{for(const player of ctx.players.values())player.state.ticket=true;},createInstructions:()=>{},getActions:()=>event.actions,
      resolveRound:ctx=>{ctx.world.facts.add('arrived');ctx.publicResult('到站','车已停稳');},describeSituation:()=> '已到站',
      evaluateEnding:(_ctx,forced)=>forced?{id:'arrived',title:'抵达',narrative:'下车',collectiveSuccess:true}:null,
      evaluatePlayer:()=>({identity:'普通乘客',escaped:true,reason:'抵达',choices:[]})
    };
    validateScenario(definition); const game=make('bus',definition,2);game.advance(pub(game).stageId);game.advance(pub(game).stageId);perform(game);read(game);
    expect(pub(game).ending!.id).toBe('arrived'); expect(pub(game).facts).toEqual(['已到站']);
  });
  it('重开清除指令、征兆、回放与已读，阶段编号不倒退',()=>{const game=complete('reset');const stage=pub(game).stageId;game.reset('new');expect(pub(game).stageId).toBeGreaterThan(stage);expect(pub(game).replay).toEqual([]);ids.forEach(id=>{const p=game.getPrivateSnapshot(id);expect(p.results).toEqual([]);expect(p.instruction).toBeNull();expect(p.symptoms).toEqual([]);});});
});
describe('情境规则与感染因果',()=>{
  it('回应与护持确实改变门禁和接触',()=>{const unguarded=round('first_knock',{p0:{actionId:'answer_door'}});scenario.resolveRound(unguarded.ctx);expect(unguarded.ctx.players.get('p0')!.state.exposure).toBe(1);const guarded=round('first_knock',{p0:{actionId:'answer_door'},p1:{actionId:'protect',targetId:'p0'}});scenario.resolveRound(guarded.ctx);expect(guarded.ctx.players.get('p0')!.state.exposure).toBe(0);expect(guarded.ctx.world.facts.has('door_released')).toBe(true);});
  it('一份护持只抵挡一次接触，同轮多原因最多进一阶',()=>{const value=round('voice_receipt',{p0:{actionId:'answer_call'},p1:{actionId:'protect',targetId:'p0'},p2:{actionId:'spread',targetId:'p0'},p3:{actionId:'spread',targetId:'p0'}},{p2:3,p3:3});scenario.resolveRound(value.ctx);expect(value.ctx.players.get('p0')!.state.exposure).toBe(1);expect(value.causes.filter(cause=>cause.includes('真实状态变化')&&cause.startsWith('p0:'))).toHaveLength(1);});
  it('真实阶段3和已获知身份共同限制传播',()=>{const value=round('voice_receipt',{p0:{actionId:'spread',targetId:'p1'}},{p0:2});expect(()=>scenario.resolveRound(value.ctx)).toThrow('尚未觉醒');});
  it('主动抵抗可以阻断他人的传播',()=>{const value=round('voice_receipt',{p0:{actionId:'spread',targetId:'p1'},p1:{actionId:'resist'}},{p0:3});scenario.resolveRound(value.ctx);expect(value.ctx.players.get('p1')!.state.exposure).toBe(0);});
  it('每人的指令最多一条，上限半数，有意互斥来自不同历史',()=>{const value=round('first_knock');value.ctx.players.get('p0')!.state.investigated=true;value.ctx.players.get('p1')!.state.registered=true;scenario.createInstructions(value.ctx,new SeededRandom('directives'));const directives=[...value.ctx.players.values()].filter(p=>p.instruction);expect(directives.length).toBeLessThanOrEqual(2);expect(directives.map(p=>p.instruction!.id).sort()).toEqual(['another_answers','nobody_answers']);});
  it('没有签名历史时不强制互斥，从而保留零感染路径',()=>{const value=round('first_knock');scenario.createInstructions(value.ctx,new SeededRandom('no-forced'));expect([...value.ctx.players.values()].filter(p=>p.instruction)).toHaveLength(1);});
  it('违抗按真实行动判定，护持不能免除违抗代价',()=>{const value=round('first_knock',{p1:{actionId:'protect',targetId:'p0'}});value.ctx.players.get('p0')!.instruction={id:'another_answers',data:{},view:{title:'测试',text:'本轮至少另一人回应',warning:'可拒绝'}};scenario.resolveRound(value.ctx);expect(value.ctx.players.get('p0')!.state.exposure).toBe(1);expect(value.results.get('p0')!.join()).toContain('没有满足');});
  it('冷水使正常人也获得同类征兆，不能用征兆当确定检测',()=>{const value=round('holy_water',{p0:{actionId:'inspect_water'}});scenario.resolveRound(value.ctx);expect(value.ctx.players.get('p0')!.state.exposure).toBe(0);expect(value.ctx.players.get('p0')!.knowledge.symptoms).toContain('有时，你的回声比你先开口。');});
  it('未披露潜伏状态不会改变可选行动',()=>{const value=round('voice_receipt');const first=value.ctx.players.get('p0')!, second=value.ctx.players.get('p1')!;second.state.exposure=1;expect(scenario.getActions(value.ctx,first)).toEqual(scenario.getActions(value.ctx,second));second.state.exposure=3;second.knowledge.identity.kind='changed';expect(scenario.getActions(value.ctx,second).some(a=>a.id==='spread')).toBe(true);expect(scenario.getActions(value.ctx,second).some(a=>a.id===value.ctx.event.defaultActionId)).toBe(true);});
  it('净化处理开始时的感染，不消除同轮新增接触',()=>{const value=round('last_wash',{p0:{actionId:'purify'},p1:{actionId:'spread',targetId:'p0'}},{p0:1,p1:3});scenario.resolveRound(value.ctx);expect(value.ctx.players.get('p0')!.state.exposure).toBe(1);expect(value.causes.join()).toContain('净化');});
  it('净化不足不产生负数，未获机会不消耗',()=>{const value=round('holy_water',Object.fromEntries(ids.map(id=>[id,{actionId:'purify'}])),Object.fromEntries(ids.map(id=>[id,1])));scenario.resolveRound(value.ctx);expect(value.ctx.world.values.purifications).toBe(0);expect([...value.ctx.players.values()].filter(p=>p.state.exposure===0)).toHaveLength(2);});
  it('异变者仍能抵抗，净化需本人请求加他人护持',()=>{const alone=round('last_wash',{p0:{actionId:'purify'}},{p0:3});scenario.resolveRound(alone.ctx);expect(alone.ctx.players.get('p0')!.state.exposure).toBe(3);expect(alone.ctx.world.values.purifications).toBe(2);const together=round('last_wash',{p0:{actionId:'purify'},p1:{actionId:'protect',targetId:'p0'}},{p0:3});scenario.resolveRound(together.ctx);expect(together.ctx.players.get('p0')!.state.exposure).toBe(1);expect(together.ctx.world.values.purifications).toBe(1);});
  it('提供至少12个节点、每幕2～3行动，拒绝路线有替代事件',()=>{expect(scenario.events.length).toBeGreaterThanOrEqual(12);for(const event of scenario.events)expect(event.actions.length).toBeLessThanOrEqual(3);const value=round('first_knock');scenario.resolveRound(value.ctx);const next=scenario.events.filter(event=>matchesEvent(event,{...value.ctx,round:3}));expect(next.map(event=>event.id)).toContain('service_warning');expect(next.map(event=>event.id)).not.toContain('voice_receipt');});
  it('配置在开局之前验证非法选项、权重、默认行为',()=>{expect(()=>validateScenario({...scenario,events:[{...scenario.events[0]!,actions:[]}]})).toThrow('选择');expect(()=>validateScenario({...scenario,events:[{...scenario.events[0]!,weight:0}]})).toThrow('权重');expect(()=>validateScenario({...scenario,events:[{...scenario.events[0]!,defaultActionId:'missing'}]})).toThrow('默认');});
  it.each(['safe-dawn','carried-out','sealed-hotel','new-guests'])('终局%s由事实、状态和选择确定',expected=>{const requests=Object.fromEntries(ids.map(id=>[id,{actionId:expected==='sealed-hotel'?'stay':expected==='carried-out'?'direct_leave':'verify_leave'}]));const facts=expected==='new-guests'?[]:['manifest_confirmed','door_released','boundary_verified'];const value=round('final_exit',requests,expected==='carried-out'?{p0:1}:{},facts);scenario.resolveRound(value.ctx);expect(scenario.evaluateEnding(value.ctx,true)!.id).toBe(expected);});
});
