import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStories, validateStory, personalizeStory } from '../stories.mjs';
import { createRoom, joinRoom, act, snapshot } from '../engine.mjs';
import { createGameServer } from '../server.mjs';

for(const [storyId,keyword,expectedCulprit] of [['last-ferry','渡口','manager'],['mermaid-letter','暗渠','teacher']]){
const story=loadStories(undefined,'story.v1.json').get(storyId),culprit=story.answer.culpritId,reason=story.answer.reasonId;
const [innocent,otherInnocent]=story.roles.filter(r=>!r.isCulprit).map(r=>r.id);
const test=(name,run)=>nodeTest(`《${story.title}》${name}`,run);
function setup(){
  const room=createRoom(story.id,{playMode:story.playMode});
  const players=['小明','阿杰','小雨','小林'].map(n=>joinRoom(room,story,n));
  const action=(kind,data={},credential=room.hostToken)=>act(room,story,credential,{kind,stageId:room.stageId,...data});
  const view=(credential=room.hostToken)=>snapshot(room,story,credential);
  const startSearch=()=>{action('start');action('screen_next');action('screen_next');};
  const toConfrontation=(same=false)=>{startSearch();for(let r=0;r<2;r++){players.forEach((p,i)=>action('screen_search',{playerId:p.id,locationId:story.locations[same?0:i].id}));action('screen_next');}};
  const toVote=()=>{toConfrontation();players.forEach(p=>action('screen_speak',{playerId:p.id,value:true}));action('screen_next');};
  return {room,players,action,view,startSearch,toConfrontation,toVote};
}
test('四人本独立配置四个角色、四个地点、八份物证及完整引用',()=>{
  validateStory(story);assert.equal(story.players,4);assert.equal(story.roles.length,4);assert.equal(story.locations.length,4);assert.equal(story.evidence.length,8);
  assert.equal(story.roles.filter(r=>r.isCulprit).length,1);assert.equal(story.answer.culpritId,expectedCulprit);assert.equal(story.answer.reasonId,'D');
  assert.equal(story.playMode,'screen-led');assert.ok(loadStories().has('last-ferry')&&loadStories().has('mermaid-letter'));
});
test('四人本拒绝三人开局和第五人加入，四人各得不同角色且凶手仅一人',()=>{
  const room=createRoom(story.id,{playMode:story.playMode});const players=[];
  for(const name of ['甲','乙','丙'])players.push(joinRoom(room,story,name));
  assert.throws(()=>act(room,story,room.hostToken,{kind:'start',stageId:room.stageId}),/需要4/);
  players.push(joinRoom(room,story,'丁'));assert.throws(()=>joinRoom(room,story,'戊'),/已满/);
  act(room,story,room.hostToken,{kind:'start',stageId:room.stageId});
  assert.equal(new Set(players.map(p=>p.roleId)).size,4);
  assert.ok(players.every(p=>snapshot(room,story,p.token).me.role===null));
  act(room,story,room.hostToken,{kind:'screen_next',stageId:room.stageId});
  assert.equal(players.filter(p=>snapshot(room,story,p.token).me.role.isCulprit).length,1);
});
test('四人本按昵称代入并隔离公共故事、私卡和未公开提示',()=>{
  const s=setup(),original=JSON.stringify(story);s.action('start');
  assert.ok(s.view().public.briefing.background.includes(keyword));assert.equal(s.view(s.players[0].token).me.role,null);
  s.action('screen_next');const rendered=personalizeStory(story,s.players),publicJSON=JSON.stringify(s.view());
  for(const p of s.players){
    const own=s.view(p.token);assert.equal(own.me.role.name,p.nickname);assert.equal(own.me.role.card.facts.length,3);
    assert.deepEqual(own.me.responseHints,[]);
    for(const field of ['opening','briefing','evidence','players','reasonOptions','replay','timeline','result'])assert.equal(field in own.public,false);
    for(const r of rendered.roles){assert.ok(!publicJSON.includes(r.actionCard.history[0].text));if(r.id!==p.roleId)assert.ok(!JSON.stringify(own).includes(r.actionCard.history[0].text));}
    assert.ok(!JSON.stringify(own).includes('{{role:'));
  }
  s.action('screen_next');s.action('screen_search',{playerId:s.players[0].id,locationId:story.locations[0].id});
  for(const p of s.players){assert.deepEqual(s.view(p.token).me.responseHints.map(h=>h.id),[story.evidence[0].id]);assert.throws(()=>s.action('screen_next',{},p.token),e=>e.status===403);}
  assert.equal(JSON.stringify(story),original);
});
test('四人重复选同处仍能在对质补齐八证，不能提前调取第二轮',()=>{
  const s=setup();s.startSearch();assert.throws(()=>s.action('screen_supplement',{evidenceId:story.evidence.at(-1).id}),/最后对质/);
  for(let round=0;round<2;round++){s.players.forEach(p=>s.action('screen_search',{playerId:p.id,locationId:story.locations[1].id}));s.action('screen_next');}
  assert.equal(s.room.published.length,2);assert.equal(s.view().public.missing.length,6);
  for(const e of story.evidence)s.action('screen_supplement',{evidenceId:e.id});
  assert.equal(s.room.published.length,8);assert.deepEqual(s.view().public.missing,[]);
});
test('四张纸票必须全部有效才写入，三张、重复玩家和错误末票均不产生部分结果',()=>{
  const s=setup();s.toVote();const ballots=s.players.map(p=>({playerId:p.id,suspectId:culprit,reasonId:reason}));
  for(const invalid of [ballots.slice(0,3),[...ballots.slice(0,3),ballots[0]],[...ballots.slice(0,3),{...ballots[3],reasonId:'bad'}]]){
    assert.throws(()=>s.action('screen_votes',{revealed:true,ballots:invalid}));assert.ok(s.players.every(p=>p.ballot===null));assert.equal(s.view().public.result,null);
  }
});
for(const [label,votes,key,complete] of [
  ['三票正确、一票不同',[[culprit,reason],[culprit,reason],[culprit,reason],[innocent,'A']],'solved',3],
  ['三票认对人、仅两票过程正确',[[culprit,reason],[culprit,reason],[culprit,'A'],[innocent,'A']],'partial',2],
  ['三票错误指认',[[otherInnocent,'A'],[otherInnocent,'B'],[otherInnocent,reason],[culprit,reason]],'wrong',1],
  ['二比二不形成多数',[[culprit,reason],[culprit,reason],[innocent,'A'],[innocent,'A']],'divided',2],
  ['二比一比一不形成多数',[[culprit,reason],[culprit,reason],[innocent,'A'],[otherInnocent,'B']],'divided',2]
])test(`四人纸票裁决：${label}`,()=>{
  const s=setup();s.toVote();s.action('screen_votes',{revealed:true,ballots:s.players.map((p,i)=>({playerId:p.id,suspectId:votes[i][0],reasonId:votes[i][1]}))});
  const v=s.view();assert.equal(v.public.stage,'ended');assert.equal(v.public.result.key,key);assert.equal(v.public.result.majority,3);assert.equal(v.public.result.completeVotes,complete);
  assert.equal(v.public.result.players.length,4);assert.equal(v.public.evidence.length,8);assert.equal(v.public.replay.length,story.screenReplay.length);
  assert.ok(v.public.result.players.every(p=>p.testimony===null&&p.name===p.nickname));assert.ok(!JSON.stringify(v).includes('{{role:'));
  for(const p of s.players){assert.equal('result' in s.view(p.token).public,false);assert.equal('replay' in s.view(p.token).public,false);}
});
test('四人真实HTTP整局在纸票阶段重启，保留角色与公开证据后正常结算',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'four-case-')),dataFile=join(temp,'rooms.json');let app;
  async function boot(){app=createGameServer({dataFile});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${app.server.address().port}`;}
  let base=await boot();
  const request=async(path,token,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{'Content-Type':'application/json'}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,await r.clone().text());return r.json();};
  try{
    const created=await request('/api/demo',null,{storyId}),prefix=`/api/rooms/${created.code}`;
    assert.equal(created.players.length,4);
    const view=token=>request(prefix+'/state',token);
    const action=async(kind,data={})=>{const v=await view(created.token);return request(prefix+'/action',created.token,{kind,stageId:v.public.stageId,...data});};
    await action('start');await action('screen_next');await action('screen_next');
    let host=await view(created.token);
    for(let round=0;round<2;round++)await action('screen_next');
    const before=await view(created.players[0].token);await app.close();base=await boot();
    const after=await view(created.players[0].token);assert.deepEqual(after,before);
    host=await view(created.token);assert.equal(host.public.evidence.length,8);assert.equal(host.public.stage,'vote');
    const final=await action('screen_votes',{revealed:true,ballots:host.public.players.map(p=>({playerId:p.id,suspectId:culprit,reasonId:reason}))});
    assert.equal(final.public.result.key,'solved');assert.equal(final.public.result.majority,3);
    await action('reset');assert.equal((await view(created.players[0].token)).me.role,null);
  }finally{if(app)await app.close();rmSync(temp,{recursive:true,force:true});}
});

}
