import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStories, validateStory, personalizeStory } from '../stories.mjs';
import { createRoom, joinRoom, act, snapshot } from '../engine.mjs';

const story=loadStories(undefined,'story.v1.json').get('after-closing');
function setup(){
  const room=createRoom(story.id,{playMode:story.playMode});
  const players=['小明','阿杰','小雨'].map(name=>joinRoom(room,story,name));
  const action=(kind,data={},credential=room.hostToken)=>act(room,story,credential,{kind,stageId:room.stageId,...data});
  const view=(credential=room.hostToken)=>snapshot(room,story,credential);
  const toSearch=()=>{action('start');action('screen_next');action('screen_next');};
  const searchRound=(same=false)=>{players.forEach((p,i)=>action('screen_search',{playerId:p.id,locationId:story.locations[same?0:i].id}));};
  const toConfrontation=(same=false)=>{toSearch();searchRound(same);action('screen_next');searchRound(same);action('screen_next');};
  const toVote=()=>{toConfrontation();players.forEach(p=>action('screen_speak',{playerId:p.id,value:true}));action('screen_next');};
  return {room,players,action,view,toSearch,searchRound,toConfrontation,toVote};
}
test('公共屏模式内容完整，校验拒绝缺失行动卡、应对方向或公开关系',()=>{
  validateStory(story);
  for(const mutate of [s=>delete s.roles[0].actionCard,s=>delete s.evidence[0].screenHints,s=>s.briefing.relations[1].roleId=s.briefing.relations[0].roleId]){
    const bad=structuredClone(story);mutate(bad);assert.throws(()=>validateStory(bad));
  }
});
test('先共同开场再发私卡，开场与开场中止都不会提前泄漏身份',()=>{
  const s=setup();s.action('start');assert.equal(s.room.stage,'opening');
  assert.deepEqual(s.view().public.stageOrder.slice(0,4),['lobby','opening','dossier','search1']);
  assert.ok(s.view().public.briefing.background.includes('旧钟馆'));
  for(const p of s.players){const v=s.view(p.token);assert.equal(v.me.role,null);assert.deepEqual(v.me.responseHints,[]);assert.equal('briefing' in v.public,false);assert.equal('opening' in v.public,false);}
  assert.ok(!JSON.stringify(s.view()).includes('isCulprit'));
  s.action('abort');assert.equal(s.view(s.players[0].token).me.role,null);
});
test('手机只收到本人简卡，公共屏不含任何人的目标或私人经历',()=>{
  const s=setup();s.action('start');s.action('screen_next');
  const rendered=personalizeStory(story,s.players),shared=JSON.stringify(s.view());
  const hidden=['opening','briefing','evidence','locations','rules','anchors','reasonOptions','result','replay','timeline','players'];
  for(const p of s.players){
    const v=s.view(p.token),r=v.me.role;
    assert.equal(r.name,p.nickname);assert.equal(r.card.facts.length,3);assert.equal(typeof r.card.focus,'string');
    assert.ok(r.card.goal);assert.equal('dossier' in r,false);assert.equal('testimony' in r,false);
    for(const key of hidden)assert.equal(key in v.public,false,key);
    for(const role of rendered.roles){
      assert.ok(!shared.includes(role.actionCard.history[0].text));
      if(role.id!==p.roleId)assert.ok(!JSON.stringify(v).includes(role.actionCard.history[0].text));
    }
    assert.ok(!JSON.stringify(v).includes('{{role:'));
  }
});
test('手机凭证拒绝所有主动游戏操作，不能通过伪造参数获得公共权限',()=>{
  const s=setup();s.toSearch();
  for(const kind of ['start','reset','abort','remove','ready','search','publish','cite','supplement','speak','hint_request','hint_approve','vote','screen_next','screen_search','screen_hint','screen_votes']){
    const before=JSON.stringify(s.room);
    assert.throws(()=>s.action(kind,{playerId:s.players[0].id,locationId:'gallery',value:true},s.players[0].token),e=>e.status===403,kind);
    assert.equal(JSON.stringify(s.room),before);
  }
});
test('每轮每人一次口头调查，立即公开且不自动推进，未登记完不能结束',()=>{
  const s=setup();s.toSearch();const p=s.players[0];
  assert.throws(()=>s.action('screen_next'),/登记/);
  assert.throws(()=>s.action('screen_search',{playerId:'missing',locationId:'gallery'}));
  s.action('screen_search',{playerId:p.id,locationId:'gallery'});
  s.action('screen_search',{playerId:p.id,locationId:'gallery'});
  assert.equal(s.room.published.length,1);assert.equal(p.evidenceIds.length,1);
  assert.throws(()=>s.action('screen_search',{playerId:p.id,locationId:'workshop'}),/已调查/);
  assert.throws(()=>s.action('screen_supplement',{evidenceId:'C06'}),/最后对质/);
  for(const current of s.players.slice(1))s.action('screen_search',{playerId:current.id,locationId:'gallery'});
  assert.equal(s.room.stage,'search1');s.action('screen_next');assert.equal(s.room.stage,'search2');
  assert.equal(s.view().public.evidence[0].id,'C01');
  const old=s.room.stageId-1;assert.throws(()=>s.action('screen_next',{stageId:old}),/阶段已变化/);
});
test('应对方向只随已公开证据解锁，不发送其他卡正文和未来阶段方向',()=>{
  const s=setup();s.toSearch();
  assert.deepEqual(s.view(s.players[0].token).me.responseHints,[]);
  s.action('screen_search',{playerId:s.players[0].id,locationId:'gallery'});
  for(const p of s.players){
    const v=s.view(p.token);assert.deepEqual(v.me.responseHints.map(h=>h.id),['C01']);
    assert.equal(typeof v.me.role.card.focus,'string');
    assert.ok(!JSON.stringify(v).includes(story.evidence[1].text));
    assert.ok(!JSON.stringify(v).includes('screenHints'));
  }
});
test('重复选地点可补齐全部物证，对质登记可撤回，提示需全桌口头同意',()=>{
  const s=setup();s.toConfrontation(true);assert.equal(s.room.published.length,2);assert.equal(s.view().public.missing.length,4);
  assert.throws(()=>s.action('screen_next'),/登记完成/);
  assert.throws(()=>s.action('screen_hint'),/口头同意/);
  s.action('screen_hint',{agreed:true});assert.equal(s.room.hintLevel,1);
  for(const e of story.evidence)s.action('screen_supplement',{evidenceId:e.id});
  assert.equal(s.room.published.length,6);assert.deepEqual(s.view().public.missing,[]);
  for(const p of s.players)s.action('screen_speak',{playerId:p.id,value:true});
  s.action('screen_speak',{playerId:s.players[0].id,value:false});assert.throws(()=>s.action('screen_next'),/登记完成/);
  s.action('screen_speak',{playerId:s.players[0].id,value:true});s.action('screen_next');assert.equal(s.room.stage,'vote');
});
test('纸票不完整、重复、未知或未揭开都不能录入，不留下部分选票',()=>{
  const s=setup();s.toVote();
  const ballots=s.players.map(p=>({playerId:p.id,suspectId:'broker',reasonId:'C'}));
  const invalid=[{ballots},{revealed:true,ballots:ballots.slice(0,2)},{revealed:true,ballots:[ballots[0],ballots[0],ballots[2]]},{revealed:true,ballots:[...ballots.slice(0,2),{...ballots[2],reasonId:'bad'}]}];
  for(const data of invalid){assert.throws(()=>s.action('screen_votes',data));assert.ok(s.players.every(p=>p.ballot===null));assert.equal(s.view().public.result,null);}
});
for(const [key,votes] of [
  ['solved',[['broker','C'],['broker','C'],['restorer','A']]],
  ['partial',[['broker','A'],['broker','A'],['broker','C']]],
  ['wrong',[['restorer','A'],['restorer','B'],['broker','C']]],
  ['divided',[['broker','C'],['restorer','A'],['archivist','A']]]
])test(`纸票整局结算：${key}，复盘仅在公共屏，旧案没有证词选择`,()=>{
  const s=setup();s.toVote();
  const ballots=s.players.map((p,i)=>({playerId:p.id,suspectId:votes[i][0],reasonId:votes[i][1]}));
  s.action('screen_votes',{revealed:true,ballots});
  const v=s.view();assert.equal(v.public.stage,'ended');assert.equal(v.public.result.key,key);assert.equal(v.public.result.majority,2);
  assert.ok(v.public.result.players.every(p=>p.testimony===null&&p.ballot.testify===false&&p.name===p.nickname));
  assert.ok(!JSON.stringify(v.public.replay).includes('署名'));assert.ok(!JSON.stringify(v).includes('{{role:'));
  for(const p of s.players){const own=s.view(p.token);assert.equal(own.public.stage,'ended');assert.equal('result' in own.public,false);assert.equal('replay' in own.public,false);assert.equal(own.me.role.id,p.roleId);}
  assert.throws(()=>s.action('screen_votes',{revealed:true,ballots}),/当前不能/);
});
test('缺少模式字段的旧局沿用旧阶段与手机操作，中止重开才切换新版',()=>{
  const s=setup();delete s.room.playMode;delete s.room.cardsReleased;
  s.action('start');assert.equal(s.room.stage,'dossier');assert.ok(s.view(s.players[0].token).me.role.dossier);
  for(const p of s.players)s.action('ready',{value:true},p.token);assert.equal(s.room.stage,'opening');
  s.action('abort');s.action('reset');assert.equal(s.room.playMode,'screen-led');
  s.action('start');assert.equal(s.room.stage,'opening');assert.equal(s.view(s.players[0].token).me.role,null);
});
