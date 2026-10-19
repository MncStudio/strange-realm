import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStories, validateStory, personalizeStory } from '../stories.mjs';
import { createRoom, joinRoom, act, snapshot } from '../engine.mjs';

const stories=loadStories();
function setup(story){
  const room=createRoom(story.id,{playMode:'screen-led',flowVersion:2});
  const players=story.roles.map((_,i)=>joinRoom(room,story,`朋友${i+1}`));
  const action=(kind,data={},credential=room.hostToken)=>act(room,story,credential,{kind,stageId:room.stageId,...data});
  const view=(credential=room.hostToken)=>snapshot(room,story,credential);
  const advanceTo=stage=>{if(room.stage==='lobby')action('start');while(room.stage!==stage)action('screen_next');};
  return {room,players,action,view,advanceTo};
}
for(const story of [...stories.values()].filter(s=>s.flowVersion===2)){
  test(`《${story.title}》短开场、私人亲历与可核验原件都有配置`,()=>{
    validateStory(story);
    assert.ok(story.briefing.background.length+story.briefing.scene.length<240);
    assert.equal(story.roles.length,story.players);
    for(const r of story.roles){
      assert.equal(r.actionCard.facts.length,3);assert.ok(r.actionCard.starter);
      assert.ok(r.actionCard.facts.some(t=>t.includes('{{role:')),'每人有与他人相关的亲历，而非只有自己的不在场证明');
    }
    for(const mutate of [s=>delete s.conversation,s=>delete s.roles[0].actionCard.starter,s=>s.evidence[0].verification=17]){
      const bad=structuredClone(story);mutate(bad);assert.throws(()=>validateStory(bad));
    }
  });
  test(`《${story.title}》按剧情发证，无需选地点、登记发言或做选择题`,()=>{
    const s=setup(story);s.action('start');assert.equal(s.room.stage,'opening');
    assert.ok(!s.view().public.stageOrder.includes('confrontation'));
    for(const p of s.players)assert.equal(s.view(p.token).me.role,null);
    s.action('screen_next');assert.equal(s.room.stage,'dossier');
    s.action('screen_next');assert.equal(s.room.stage,'search1');assert.equal(s.room.published.length,story.locations.length);
    const old=s.room.stageId;
    for(const kind of ['screen_search','screen_supplement','screen_speak']){
      const before=JSON.stringify(s.room);assert.throws(()=>s.action(kind,{playerId:s.players[0].id,locationId:story.locations[0].id,value:true}));assert.equal(JSON.stringify(s.room),before);
    }
    assert.deepEqual(s.view().public.reasonOptions,[]);
    assert.ok(s.view().public.evidence.every(e=>!('question' in e)));
    assert.ok(s.players.every(p=>Object.keys(p.searches).length===0&&!p.spoke));
    s.action('screen_next');assert.equal(s.room.stage,'search2');assert.equal(s.room.published.length,story.evidence.length);
    assert.throws(()=>s.action('screen_next',{stageId:old}),/阶段已变化/);
    s.action('screen_next');assert.equal(s.room.stage,'vote');assert.deepEqual(s.view().public.reasonOptions,[]);
  });
  test(`《${story.title}》手机只含自己的亲历，发证不自动添加教学提示`,()=>{
    const s=setup(story);s.advanceTo('search2');const rendered=personalizeStory(story,s.players);
    const shared=JSON.stringify(s.view());
    for(const p of s.players){
      const own=s.view(p.token);assert.equal(own.me.role.name,p.nickname);
      for(const key of ['opening','briefing','evidence','players','discussion','reasonOptions','result','replay'])assert.ok(!(key in own.public));
      assert.ok(!('focus' in own.me.role.card));assert.deepEqual(own.me.responseHints,[]);
      for(const r of rendered.roles){
        assert.ok(!shared.includes(r.actionCard.history[0].text));
        if(r.id!==p.roleId)assert.ok(!JSON.stringify(own).includes(r.actionCard.history[0].text));
      }
      for(const kind of ['screen_next','screen_verify','screen_votes','screen_hint'])assert.throws(()=>s.action(kind,{},p.token),e=>e.status===403);
    }
  });
  test(`《${story.title}》原件核验需主动请求且不能偷看未来证据`,()=>{
    const s=setup(story),e=story.evidence.find(e=>e.verification);assert.ok(e);
    s.advanceTo('search1');assert.throws(()=>s.action('screen_verify',{evidenceId:e.id}));
    assert.ok(!JSON.stringify(s.view()).includes(e.verification));
    s.action('screen_next');const card=s.view().public.evidence.find(x=>x.id===e.id);
    assert.equal(card.canVerify,true);assert.ok(!('verification' in card));
    s.action('screen_verify',{evidenceId:e.id});s.action('screen_verify',{evidenceId:e.id});
    assert.equal(s.room.verified.length,1);assert.ok(s.view().public.evidence.find(x=>x.id===e.id).verification);
    for(const p of s.players)assert.ok(!('evidence' in s.view(p.token).public));
    s.action('screen_next');assert.throws(()=>s.action('screen_verify',{evidenceId:e.id}),/讨论期间/);
  });
  test(`《${story.title}》只凭嫌疑人票结算，恶意判断字段不起作用`,()=>{
    const s=setup(story);s.advanceTo('vote');const culprit=story.answer.culpritId;
    const ballots=s.players.map(p=>({playerId:p.id,suspectId:culprit,reasonId:'invalid',testify:true}));
    for(const invalid of [ballots.slice(1),ballots.map((b,i)=>i===1?ballots[0]:b),ballots.map((b,i)=>i===1?{...b,suspectId:'missing'}:b)]){
      assert.throws(()=>s.action('screen_votes',{revealed:true,ballots:invalid}));assert.ok(s.players.every(p=>p.ballot===null));
    }
    s.action('screen_votes',{revealed:true,ballots});const r=s.view().public.result;
    assert.equal(r.key,'solved');assert.equal(r.completeVotes,story.players);assert.deepEqual(r.answer,{culpritId:culprit});
    assert.ok(r.players.every(p=>Object.keys(p.ballot).join()==='suspectId'&&p.testimony===null));
    for(const p of s.players)assert.ok(!('result' in s.view(p.token).public));
  });
  test(`《${story.title}》错误多数与分票仍公平裁决`,()=>{
    const innocent=story.roles.find(r=>!r.isCulprit).id;
    for(const [key,targets] of [['wrong',story.roles.map(()=>innocent)],['divided',story.players===3?story.roles.map(r=>r.id):[story.answer.culpritId,story.answer.culpritId,innocent,innocent]]]){
      const s=setup(story);s.advanceTo('vote');s.action('screen_votes',{revealed:true,ballots:s.players.map((p,i)=>({playerId:p.id,suspectId:targets[i]}))});assert.equal(s.view().public.result.key,key);
    }
  });
}
