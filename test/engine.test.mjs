import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStories, validateStory, storySummary, personalizeStory } from '../stories.mjs';
import { createRoom, joinRoom, act, snapshot } from '../engine.mjs';
const story = loadStories().get('snow-letter');
function setup(scenario=story) {
  const story=scenario;
  const room = createRoom(story.id);
  const players = Array.from({length:story.players},(_,i)=>joinRoom(room,story,`朋友${i+1}`));
  const action = (credential,kind,data={}) => act(room,story,credential,{kind,stageId:room.stageId,...data});
  const allReady = () => players.forEach(p=>action(p.token,'ready',{value:true}));
  const start = () => action(room.hostToken,'start');
  const searchRound = (same=false) => players.forEach((p,i)=>action(p.token,'search',{locationId:story.locations[same?0:i%story.locations.length].id}));
  const toConfrontation = (same=false) => {start();allReady();allReady();searchRound(same);allReady();searchRound(same);allReady();};
  const toVote = () => {toConfrontation();players.forEach(p=>{action(p.token,'speak');action(p.token,'ready',{value:true});});};
  return {room,players,action,allReady,start,searchRound,toConfrontation,toVote};
}
test('故事含六份角色、十二份证据与合法引用',()=>{assert.equal(story.roles.length,6);assert.equal(story.evidence.length,12);assert.equal(story.rules.length,8);validateStory(story);});
test('新增故事校验拒绝重复ID、未知答案、缺少地点轮次',()=>{for(const mutate of [s=>s.roles[1].id=s.roles[0].id,s=>s.answer.culpritId='missing',s=>s.evidence.pop()]){const s=structuredClone(story);mutate(s);assert.throws(()=>validateStory(s));}});
test('目录摘要不含角色和答案',()=>{assert.deepEqual(Object.keys(storySummary(story)),['id','title','tagline','description','players','duration']);});
test('人数上限、昵称与阶段限制',()=>{const s=setup();assert.throws(()=>joinRoom(s.room,story,'第七人'),/已满/);assert.throws(()=>joinRoom(createRoom(story.id),story,' '),/昵称/);s.start();assert.throws(()=>joinRoom(s.room,story,'新朋友'),/已经开始/);});
test('不足六人不能开局，玩家不能启动或移除别人',()=>{const room=createRoom(story.id);const p=joinRoom(room,story,'甲');assert.throws(()=>act(room,story,room.hostToken,{kind:'start',stageId:room.stageId}),/需要6/);assert.throws(()=>act(room,story,p.token,{kind:'start',stageId:room.stageId}),/公共屏/);});
test('随机分配六个不同角色，凶手本人知情',()=>{const s=setup();s.start();assert.equal(new Set(s.players.map(p=>p.roleId)).size,6);assert.equal(s.players.filter(p=>snapshot(s.room,story,p.token).me.role.isCulprit).length,1);});
test('公共屏收不到私人档案、线索提示、选票或答案',()=>{const s=setup();s.start();const v=snapshot(s.room,story,s.room.hostToken);assert.equal(v.me,null);assert.equal(v.public.result,null);assert.deepEqual(v.public.replay,[]);assert.deepEqual(v.public.reasonOptions,[]);const data=JSON.stringify(v);for(const p of s.players){assert.ok(!data.includes(p.token));const r=story.roles.find(r=>r.id===p.roleId);assert.ok(!data.includes(r.dossier[0].text));}assert.ok(!data.includes('isCulprit'));});
test('玩家收到自己的完整档案，但不收到其他人的整份档案',()=>{const s=setup();s.start();const v=snapshot(s.room,story,s.players[0].token);assert.equal(v.me.role.id,s.players[0].roleId);for(const r of story.roles.filter(r=>r.id!==s.players[0].roleId))assert.ok(!JSON.stringify(v).includes(r.dossier[0].text));assert.throws(()=>snapshot(s.room,story,'x'.repeat(43)),/凭证/);});
test('公共屏不能替玩家确认，前端篡改快照无效',()=>{const s=setup();s.start();assert.throws(()=>s.action(s.room.hostToken,'ready',{value:true}),/不能代替/);const view=snapshot(s.room,story,s.players[0].token);view.me.role.name='篡改';view.public.players.length=0;assert.equal(s.room.players.length,6);assert.notEqual(snapshot(s.room,story,s.players[0].token).me.role.name,'篡改');});
test('全员读完自动推进，旧阶段消息不影响下一阶段',()=>{const s=setup();s.start();const old=s.room.stageId;s.allReady();assert.equal(s.room.stage,'opening');assert.throws(()=>s.action(s.players[0].token,'ready',{value:true,stageId:old}),/阶段已变化/);assert.ok(s.players.every(p=>!p.ready));});
test('搜证前不能完成，每轮只能选一处，同处重复提交幂等',()=>{const s=setup();s.start();s.allReady();s.allReady();assert.throws(()=>s.action(s.players[0].token,'ready',{value:true}),/先调查/);s.action(s.players[0].token,'search',{locationId:'study'});s.action(s.players[0].token,'search',{locationId:'study'});assert.equal(s.players[0].evidenceIds.length,1);assert.throws(()=>s.action(s.players[0].token,'search',{locationId:'front'}),/已经调查/);});
test('私人搜证只给本人，拒绝提前访问第二轮及他人未公开物证',()=>{const s=setup();s.start();s.allReady();s.allReady();s.action(s.players[0].token,'search',{locationId:'study'});assert.equal(snapshot(s.room,story,s.players[0].token).me.evidence.length,1);assert.equal(snapshot(s.room,story,s.players[1].token).me.evidence.length,0);assert.equal(snapshot(s.room,story,s.room.hostToken).public.evidence.length,0);assert.throws(()=>s.action(s.players[1].token,'publish',{evidenceId:'E01'}),/还没有取得/);assert.throws(()=>s.action(s.players[0].token,'supplement',{evidenceId:'E08'}),/最后对质/);});
test('新物证公开清除完成标记，重复公开不会反复清除',()=>{const s=setup();s.start();s.allReady();s.allReady();s.searchRound();s.action(s.players[1].token,'ready',{value:true});s.action(s.players[0].token,'publish',{evidenceId:'E01'});assert.ok(!s.players[1].ready);s.action(s.players[1].token,'ready',{value:true});s.action(s.players[0].token,'publish',{evidenceId:'E01'});assert.ok(s.players[1].ready);});
test('引用非法对象不产生部分公开，合法引用是公开问题',()=>{const s=setup();s.start();s.allReady();s.allReady();s.searchRound();assert.throws(()=>s.action(s.players[0].token,'cite',{evidenceId:'E01',targetId:'missing'}));assert.equal(s.room.published.length,0);s.action(s.players[0].token,'cite',{evidenceId:'E01',targetId:s.players[1].id});assert.equal(s.room.published.length,1);assert.equal(s.room.citations[0].targetId,s.players[1].id);});
test('一轮结束归档所有已查物证，重复地点不阻塞后续',()=>{const s=setup();s.toConfrontation(true);assert.equal(s.room.stage,'confrontation');assert.deepEqual(s.room.published,['E01','E07']);assert.equal(snapshot(s.room,story,s.room.hostToken).public.missing.length,10);});
test('补查不受额度限制，清除所有完成标记且不会提前揭晓答案',()=>{const s=setup();s.toConfrontation(true);for(const p of s.players)s.action(p.token,'speak');s.action(s.players[1].token,'ready',{value:true});for(const e of story.evidence)s.action(s.players[0].token,'supplement',{evidenceId:e.id});assert.ok(s.players.every(p=>!p.ready));assert.equal(s.room.published.length,12);assert.equal(snapshot(s.room,story,s.room.hostToken).public.result,null);});
test('每人发言或放弃后才能准备指认',()=>{const s=setup();s.toConfrontation();assert.throws(()=>s.action(s.players[0].token,'ready',{value:true}),/发言/);for(const p of s.players){s.action(p.token,'speak');s.action(p.token,'ready',{value:true});}assert.equal(s.room.stage,'vote');});
test('提示需全员同意，主持不能替别人批准，新提示清除完成',()=>{const s=setup();s.start();s.allReady();s.allReady();s.searchRound();s.action(s.players[0].token,'ready',{value:true});s.action(s.room.hostToken,'hint_request');assert.throws(()=>s.action(s.room.hostToken,'hint_approve'),/不能代替/);for(const p of s.players.slice(0,5))s.action(p.token,'hint_approve');assert.equal(s.room.hintLevel,0);s.action(s.players[5].token,'hint_approve');assert.equal(s.room.hintLevel,1);assert.ok(s.players.every(p=>!p.ready));});
test('选票校验、保密、修改和全收齐后统一揭晓',()=>{const s=setup();s.toVote();assert.throws(()=>s.action(s.players[0].token,'vote',{suspectId:'bad',reasonId:'B',testify:true}));s.action(s.players[0].token,'vote',{suspectId:'r2',reasonId:'A',testify:false});const host=snapshot(s.room,story,s.room.hostToken);assert.equal(host.public.result,null);assert.equal(host.public.players[0].voted,true);assert.equal('ballot' in host.public.players[0],false);assert.equal(snapshot(s.room,story,s.players[1].token).me.ballot,null);for(const p of s.players)s.action(p.token,'vote',{suspectId:story.answer.culpritId,reasonId:story.answer.reasonId,testify:true});assert.equal(s.room.stage,'ended');assert.equal(s.room.result.key,'solved');assert.equal(s.room.result.players.length,6);assert.equal(snapshot(s.room,story,s.room.hostToken).public.replay.length,6);});
for(const [name,votes,key] of [['认对人但过程不对',Array(6).fill(['r1','A']),'partial'],['多数错误指认',Array(6).fill(['r2','B']),'wrong'],['分票未合',[['r1','B'],['r1','B'],['r2','A'],['r2','A'],['r3','B'],['r4','B']],'divided']])test(name,()=>{const s=setup();s.toVote();s.players.forEach((p,i)=>s.action(p.token,'vote',{suspectId:votes[i][0],reasonId:votes[i][1],testify:false}));assert.equal(s.room.result.key,key);assert.ok(s.room.result.players.every(p=>p.testimony===null));});
test('结束才能揭晓，明确中止不判胜负，重开清空秘密并拒绝旧阶段',()=>{const s=setup();s.start();const old=s.room.stageId;s.action(s.room.hostToken,'abort');assert.equal(s.room.stage,'aborted');assert.equal(snapshot(s.room,story,s.room.hostToken).public.result,null);s.action(s.room.hostToken,'reset');assert.equal(s.room.stage,'lobby');assert.ok(s.players.every(p=>p.roleId===null&&p.evidenceIds.length===0));assert.throws(()=>s.action(s.players[0].token,'ready',{value:true,stageId:old}),/阶段已变化/);s.start();assert.equal(new Set(s.players.map(p=>p.roleId)).size,6);});
test('试玩房不接受正常加入',()=>{const r=createRoom(story.id,{demo:true});assert.throws(()=>joinRoom(r,story,'真实玩家'),/试玩房/);joinRoom(r,story,'模拟玩家',{internalDemo:true});assert.equal(r.players.length,1);});

test('不同剧本与答案使用同一套流程，不写死本案角色',()=>{const alternate=structuredClone(story);alternate.id='synthetic-case';alternate.title='合成测试案例';alternate.answer={culpritId:'r6',reasonId:'A'};alternate.roles.forEach(r=>r.isCulprit=r.id==='r6');validateStory(alternate);const s=setup(alternate);s.toVote();for(const p of s.players)s.action(p.token,'vote',{suspectId:'r6',reasonId:'A',testify:false});assert.equal(s.room.result.key,'solved');assert.equal(s.room.result.answer.culpritId,'r6');assert.equal(snapshot(s.room,alternate,s.room.hostToken).public.story.title,'合成测试案例');});

const three = loadStories(undefined,'story.v1.json').get('after-closing');
test('角色引用校验拒绝不存在的角色与残缺模板',()=>{
  for(const opening of ['{{role:missing}}','{{role:broker}'])assert.throws(()=>validateStory({...three,opening}),/角色引用/);
});
test('正文按本局角色分配使用昵称，源剧本不受影响，不发送别人的私人内容',()=>{
  const before=JSON.stringify(three);const s=setup(three);s.start();
  const rendered=personalizeStory(three,s.players);
  const host=snapshot(s.room,three,s.room.hostToken);
  for(const p of s.players){
    const own=snapshot(s.room,three,p.token);
    assert.equal(own.me.role.name,p.nickname);
    assert.equal(host.public.players.find(x=>x.id===p.id).role.name,p.nickname);
    assert.ok(host.public.opening.includes(p.nickname));
    assert.equal(own.me.role.isCulprit,p.roleId===three.answer.culpritId);
    for(const role of rendered.roles){
      assert.ok(!JSON.stringify(host).includes(role.dossier[0].text));
      if(role.id!==p.roleId)assert.ok(!JSON.stringify(own).includes(role.dossier[0].text));
    }
    assert.ok(!JSON.stringify(own).includes('{{role:'));
  }
  assert.ok(host.public.opening.includes('闻绍庭'),'NPC姓名保持固定');
  assert.equal(JSON.stringify(three),before);
});
test('昵称不重复解析，玩家说法保留原文，不同房间相互隔离',()=>{
  const s=setup(three);s.start();
  const nicknames={restorer:'陆衡',broker:'$&<阿明>',archivist:'{{role:x}}'};
  for(const p of s.players)p.nickname=nicknames[p.roleId];
  const rendered=personalizeStory(three,s.players);
  assert.ok(rendered.evidence[0].text.includes('工具牌署名陆衡'));
  assert.ok(rendered.evidence[5].text.includes('$&<阿明>签署'));
  assert.ok(rendered.opening.includes('{{role:x}}'),'昵称中的模板形状作为普通文字保留');
  s.allReady();s.allReady();
  const text='我在和陆衡说话，{{role:broker}}是我输入的原文';
  s.action(s.players[0].token,'statement',{text});
  assert.equal(snapshot(s.room,three,s.room.hostToken).public.statements[0].text,text);
  const other=setup(three);other.start();
  assert.ok(!snapshot(other.room,three,other.room.hostToken).public.opening.includes('$&<阿明>'));
});
test('公开物证、私人提示、引用、选项与结局均使用同一局昵称，重开后重新绑定',()=>{
  const s=setup(three);s.start();s.allReady();s.allReady();s.searchRound();
  const p=s.players[0];const first=snapshot(s.room,three,p.token).me.evidence[0];
  s.action(p.token,'cite',{evidenceId:first.id,targetId:s.players[1].id});
  assert.equal(snapshot(s.room,three,p.token).public.citations[0].text,first.question);
  for(const current of [snapshot(s.room,three,p.token),snapshot(s.room,three,s.room.hostToken)])assert.ok(!JSON.stringify(current).includes('{{role:'));
  s.allReady();s.searchRound();s.allReady();
  for(const player of s.players){s.action(player.token,'speak');s.action(player.token,'ready',{value:true});}
  assert.ok(!JSON.stringify(snapshot(s.room,three,p.token).public.reasonOptions).includes('{{role:'));
  for(const player of s.players)s.action(player.token,'vote',{suspectId:'broker',reasonId:'C',testify:true});
  const ended=snapshot(s.room,three,s.room.hostToken);
  assert.ok(!JSON.stringify(ended).includes('{{role:'));
  for(const r of three.roles)assert.ok(!JSON.stringify(ended).includes(r.name));
  for(const result of ended.public.result.players)assert.equal(result.name,result.nickname);
  s.action(s.room.hostToken,'reset');assert.ok(s.players.every(p=>p.roleId===null));
  s.start();assert.equal(s.room.stage,'opening');
  for(const player of s.players)assert.equal(snapshot(s.room,three,player.token).me.role,null);
  s.action(s.room.hostToken,'screen_next');
  for(const player of s.players)assert.equal(snapshot(s.room,three,player.token).me.role.name,player.nickname);
});
test('三人本独立配置三名角色、三处地点和六份物证，人数下限仍校验',()=>{
  assert.ok(three); validateStory(three);
  assert.equal(three.players,3); assert.equal(three.roles.length,3);
  assert.equal(three.locations.length,3); assert.equal(three.evidence.length,6);
  assert.equal(three.roles.filter(r=>r.isCulprit).length,1);
  for(const players of [2,9])assert.throws(()=>validateStory({...three,players}),/人数范围3～8/);
});
test('三人本必须恰好三人入席，随机分配三名独立角色',()=>{
  const room=createRoom(three.id);
  const players=[joinRoom(room,three,'甲'),joinRoom(room,three,'乙')];
  assert.throws(()=>act(room,three,room.hostToken,{kind:'start',stageId:room.stageId}),/需要3/);
  players.push(joinRoom(room,three,'丙'));
  assert.throws(()=>joinRoom(room,three,'丁'),/已满/);
  act(room,three,room.hostToken,{kind:'start',stageId:room.stageId});
  assert.equal(new Set(players.map(p=>p.roleId)).size,3);
  assert.equal(players.filter(p=>snapshot(room,three,p.token).me.role.isCulprit).length,1);
});
test('三人本私人角色和线索按凭证隔离，公共屏不含秘密或答案',()=>{
  const s=setup(three);s.start();s.allReady();s.allReady();s.searchRound();
  const host=snapshot(s.room,three,s.room.hostToken);
  assert.equal(host.me,null);assert.deepEqual(host.public.evidence,[]);
  assert.equal(host.public.result,null);assert.deepEqual(host.public.replay,[]);
  for(const p of s.players){
    const own=snapshot(s.room,three,p.token);
    assert.equal(own.me.evidence.length,1);
    assert.equal(own.me.role.id,p.roleId);
    for(const r of three.roles){
      assert.ok(!JSON.stringify(host).includes(r.dossier[0].text));
      if(r.id!==p.roleId)assert.ok(!JSON.stringify(own).includes(r.dossier[0].text));
    }
    assert.ok(!JSON.stringify(host).includes(p.token));
  }
});
test('三人重复调查仍可对质补齐全部物证，新增证据重新确认',()=>{
  const s=setup(three);s.toConfrontation(true);
  assert.equal(s.room.published.length,2);
  assert.equal(snapshot(s.room,three,s.players[0].token).public.missing.length,4);
  s.action(s.players[0].token,'speak');s.action(s.players[0].token,'ready',{value:true});
  for(const e of three.evidence)s.action(s.players[1].token,'supplement',{evidenceId:e.id});
  assert.ok(s.players.every(p=>!p.ready));assert.equal(s.room.published.length,6);
  assert.deepEqual(snapshot(s.room,three,s.room.hostToken).public.missing,[]);
});
test('三人提示必须三人全体同意，两人同意不能提前揭示',()=>{
  const s=setup(three);s.start();s.allReady();s.allReady();
  s.action(s.room.hostToken,'hint_request');
  s.action(s.players[0].token,'hint_approve');s.action(s.players[1].token,'hint_approve');
  assert.equal(s.room.hintLevel,0);
  s.action(s.players[2].token,'hint_approve');assert.equal(s.room.hintLevel,1);
});
for(const [label,votes,key] of [
  ['两票正确即可形成多数',[['broker','C'],['broker','C'],['restorer','A']],'solved'],
  ['认对人但只有一票理解过程',[['broker','A'],['broker','A'],['broker','C']],'partial'],
  ['两票指向无辜者',[['restorer','A'],['restorer','B'],['broker','C']],'wrong'],
  ['三人各投一人',[['broker','C'],['restorer','A'],['archivist','A']],'divided']
])test(`三人结算：${label}`,()=>{
  const s=setup(three);s.toVote();
  s.players.forEach((p,i)=>{
    s.action(p.token,'vote',{suspectId:votes[i][0],reasonId:votes[i][1],testify:i===0});
    if(i<2){
      const host=snapshot(s.room,three,s.room.hostToken);
      assert.equal(s.room.stage,'vote');assert.equal(host.public.result,null);
      assert.equal('ballot' in host.public.players[i],false);
      assert.equal(snapshot(s.room,three,s.players[2].token).me.ballot,null);
    }
  });
  assert.equal(s.room.stage,'ended');assert.equal(s.room.result.majority,2);
  assert.equal(s.room.result.key,key);assert.equal(s.room.result.players.length,3);
  assert.ok(s.room.result.players[0].testimony);
  assert.ok(s.room.result.players.slice(1).every(p=>p.testimony===null));
  const ended=snapshot(s.room,three,s.room.hostToken);
  assert.equal(ended.public.replay.length,three.replay.length);assert.equal(ended.public.evidence.length,6);
});
