import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server.mjs';
import { createRoom, joinRoom, act } from '../engine.mjs';
import { loadStories } from '../stories.mjs';

async function boot(options={}) { const app=createGameServer({dataFile:null,...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return {app,base:`http://127.0.0.1:${app.server.address().port}`}; }
async function request(base,path,{method='GET',body,token,headers={}}={}){const response=await fetch(base+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
test('真实HTTP六人从创建到结局、投影隔离、重复阶段校验',async()=>{
  const {app,base}=await boot();
  try {
    const created=await request(base,'/api/rooms',{method:'POST',body:{storyId:'snow-letter'}});assert.equal(created.status,201);
    const {code,token:host}=created.body;const prefix=`/api/rooms/${code}`;
    const players=[];for(let i=0;i<6;i++){const joined=await request(base,prefix+'/join',{method:'POST',body:{nickname:`玩家${i}`}});assert.equal(joined.status,201);players.push(joined.body.token);}
    assert.equal((await request(base,prefix+'/join',{method:'POST',body:{nickname:'多余的人'}})).status,409);
    const get=async token=>(await request(base,prefix+'/state',{token})).body;
    const post=async(token,kind,data={})=>{const current=await get(token);const r=await request(base,prefix+'/action',{method:'POST',token,body:{kind,stageId:current.public.stageId,...data}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
    const started=await post(host,'start');assert.equal(started.me,null);assert.equal(JSON.stringify(started).includes('isCulprit'),false);
    const credentials=await Promise.all(players.map(get));assert.equal(new Set(credentials.map(v=>v.me.role.id)).size,6);
    const old=started.public.stageId;
    for(const t of players)await post(t,'ready',{value:true});
    assert.equal((await request(base,prefix+'/action',{method:'POST',token:players[0],body:{kind:'ready',value:true,stageId:old}})).status,409);
    for(const t of players)await post(t,'ready',{value:true});
    for(let round=1;round<=2;round++){for(let i=0;i<6;i++){await post(players[i],'search',{locationId:started.public.locations[i].id});await post(players[i],'ready',{value:true});}}
    for(const t of players){await post(t,'speak');await post(t,'ready',{value:true});}
    for(const t of players)await post(t,'vote',{suspectId:'r1',reasonId:'B',testify:true});
    const final=await get(host);assert.equal(final.public.stage,'ended');assert.equal(final.public.result.key,'solved');assert.equal(final.public.evidence.length,12);
    assert.equal(JSON.stringify(final.public).includes(host),false);assert.equal(final.public.result.players.length,6);
    await post(host,'reset');assert.equal((await get(players[0])).me.role,null);
  } finally { await app.close(); }
});
test('静态文件白名单与鉴权，不暴露故事/源码/存档/答案',async()=>{
  const {app,base}=await boot();try{
    for(const path of ['/stories/snow-letter/story.json','/docs/GAME.md','/data/rooms.json','/engine.mjs','/server.mjs','/package.json','/web/index.html','/..%2Fstories/snow-letter/story.json'])assert.equal((await fetch(base+path)).status,404,path);
    const info=await request(base,'/api/info');assert.equal(info.status,200);assert.equal(JSON.stringify(info.body).includes('culprit'),false);
    const create=(await request(base,'/api/rooms',{method:'POST',body:{storyId:'snow-letter'}})).body;
    assert.equal((await request(base,`/api/rooms/${create.code}/state`)).status,401);
    assert.equal((await request(base,`/api/rooms/${create.code}/state`,{token:'x'.repeat(43)})).status,401);
    assert.equal((await request(base,'/api/rooms',{method:'POST',body:{storyId:'snow-letter'},headers:{Origin:'https://example.com'}})).status,403);
    const forgedHostStatus = await new Promise((resolve,reject)=>{const req=http.get(base+'/',{headers:{Host:'evil.example.com'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(forgedHostStatus,403);
    const qr=await fetch(base+`/api/rooms/${create.code}/qr?base=${encodeURIComponent(base)}`);assert.equal(qr.status,200);assert.ok((await qr.text()).includes('<svg'));
    assert.equal((await request(base,`/api/rooms/${create.code}/qr?base=https://example.com`)).status,400);
    const oversized=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:'snow-letter',padding:'x'.repeat(20000)})});assert.equal(oversized.status,413);
  }finally{await app.close();}
});
test('SSE实时收到公开状态，不包含玩家秘密，断线后可凭原票恢复',async()=>{
  const {app,base}=await boot();const abort=new AbortController();try{
    const created=(await request(base,'/api/rooms',{method:'POST',body:{storyId:'snow-letter'}})).body;
    const joined=(await request(base,`/api/rooms/${created.code}/join`,{method:'POST',body:{nickname:'重连玩家'}})).body;
    const stream=await fetch(base+`/api/rooms/${created.code}/events?token=${created.token}`,{signal:abort.signal});assert.equal(stream.status,200);
    const reader=stream.body.getReader();let text='';while(!text.includes('event: state'))text+=new TextDecoder().decode((await reader.read()).value);
    assert.ok(!text.includes(joined.token));assert.ok(text.includes('重连玩家'));abort.abort();
    const restored=await request(base,`/api/rooms/${created.code}/state`,{token:joined.token});assert.equal(restored.body.me.nickname,'重连玩家');
  }finally{abort.abort();await app.close();}
});
test('本地存档重启恢复原房间、角色与阶段，文件不包含在线假状态',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'strange-realm-'));const file=join(temp,'rooms.json');let app;
  try{
    let booted=await boot({dataFile:file});app=booted.app;let base=booted.base;
    const created=(await request(base,'/api/demo',{method:'POST',body:{storyId:'snow-letter'}})).body;
    const prefix=`/api/rooms/${created.code}`;
    await request(base,prefix+'/action',{method:'POST',token:created.token,body:{kind:'start',stageId:1}});
    const before=(await request(base,prefix+'/state',{token:created.players[0].token})).body;
    await app.close();
    booted=await boot({dataFile:file});app=booted.app;base=booted.base;
    const after=(await request(base,prefix+'/state',{token:created.players[0].token})).body;
    assert.equal(after.public.stage,before.public.stage);assert.equal(after.me.role.id,before.me.role.id);assert.equal(after.public.stageId,before.public.stageId);
    assert.equal(after.me.role.name,after.me.nickname);assert.equal(after.me.role.name,before.me.role.name);
    assert.equal(readFileSync(file,'utf8').includes('online'),false);
    assert.equal((await request(base,prefix+'/join',{method:'POST',body:{nickname:'不应加入'}})).status,400);
  }finally{if(app)await app.close();rmSync(temp,{recursive:true,force:true});}
});

test('自动发现额外故事文件夹，目录仅返回公开摘要',async()=>{const temp=mkdtempSync(join(tmpdir(),'strange-stories-'));let app;try{const original=JSON.parse(readFileSync(new URL('../stories/snow-letter/story.json',import.meta.url),'utf8'));for(const id of ['snow-letter','synthetic-case']){const s=structuredClone(original);s.id=id;if(id==='synthetic-case')s.title='合成测试案例';mkdirSync(join(temp,id));writeFileSync(join(temp,id,'story.json'),JSON.stringify(s));}const b=await boot({storyDirectory:temp});app=b.app;const list=(await request(b.base,'/api/info')).body.stories;assert.equal(list.length,2);assert.ok(!JSON.stringify(list).includes('answer'));const created=await request(b.base,'/api/rooms',{method:'POST',body:{storyId:'synthetic-case'}});assert.equal(created.status,201);assert.equal((await request(b.base,`/api/rooms/${created.body.code}/preview`)).body.story.title,'合成测试案例');}finally{if(app)await app.close();rmSync(temp,{recursive:true,force:true});}});

test('真实HTTP三人本：目录、人数限制、完整调查、选票保密与两票多数',async()=>{
  const {app,base}=await boot();
  try{
    const info=(await request(base,'/api/info')).body;
    assert.equal(info.stories.find(s=>s.id==='after-closing').players,3);
    assert.equal(info.stories.find(s=>s.id==='snow-letter').players,6);
    assert.ok(!JSON.stringify(info.stories).includes('answer'));
    assert.equal((await fetch(base+'/stories/after-closing/story.json')).status,404);
    const created=(await request(base,'/api/rooms',{method:'POST',body:{storyId:'after-closing'}})).body;
    const prefix=`/api/rooms/${created.code}`;
    const get=async token=>(await request(base,prefix+'/state',{token})).body;
    const post=async(token,kind,data={})=>{
      const current=await get(token);
      const r=await request(base,prefix+'/action',{method:'POST',token,body:{kind,stageId:current.public.stageId,...data}});
      assert.equal(r.status,200,JSON.stringify(r.body));return r.body;
    };
    const players=[];
    for(let i=0;i<3;i++){
      if(i===2)assert.equal((await request(base,prefix+'/action',{method:'POST',token:created.token,body:{kind:'start',stageId:1}})).status,409);
      const joined=await request(base,prefix+'/join',{method:'POST',body:{nickname:`三人玩家${i+1}`}});
      assert.equal(joined.status,201);players.push(joined.body.token);
    }
    assert.equal((await request(base,prefix+'/join',{method:'POST',body:{nickname:'第四人'}})).status,409);
    await post(created.token,'start');
    assert.equal((await get(players[0])).me.role,null);
    const host=await get(created.token);assert.equal(host.me,null);assert.ok(!JSON.stringify(host).includes('isCulprit'));
    assert.equal(host.public.stage,'opening');
    assert.equal((await request(base,prefix+'/action',{method:'POST',token:players[0],body:{kind:'ready',stageId:host.public.stageId,value:true}})).status,403);
    await post(created.token,'screen_next');
    const privateViews=await Promise.all(players.map(get));
    assert.equal(new Set(privateViews.map(v=>v.me.role.id)).size,3);
    for(const view of privateViews){assert.equal('opening' in view.public,false);assert.equal('evidence' in view.public,false);assert.equal(view.me.role.name,view.me.nickname);}
    await post(created.token,'screen_next');
    for(let round=1;round<=2;round++)await post(created.token,'screen_next');
    assert.equal((await get(created.token)).public.evidence.length,6);
    assert.deepEqual((await get(created.token)).public.reasonOptions,[]);
    const ballots=host.public.players.map((p,i)=>({playerId:p.id,suspectId:i===2?'restorer':'broker',reasonId:'C'}));
    assert.equal((await get(created.token)).public.result,null);
    await post(created.token,'screen_votes',{revealed:true,ballots});
    const final=await get(created.token);
    assert.equal(final.public.stage,'ended');assert.equal(final.public.result.key,'solved');
    assert.equal(final.public.result.majority,2);assert.equal(final.public.result.completeVotes,2);
    assert.equal(final.public.result.players.length,3);assert.equal(final.public.replay.length,5);
    assert.equal('result' in (await get(players[0])).public,false);
    await post(created.token,'reset');assert.equal((await get(players[0])).me.role,null);
  }finally{await app.close();}
});

test('三人公共屏模式重启恢复，SSE手机投影仍只有本人卡与已公开提示',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'screen-save-')),file=join(temp,'rooms.json');let app;const abort=new AbortController();
  try{
    let b=await boot({dataFile:file});app=b.app;
    const created=(await request(b.base,'/api/demo',{method:'POST',body:{storyId:'after-closing'}})).body;
    const prefix=`/api/rooms/${created.code}`;
    const post=async kind=>{const v=(await request(b.base,prefix+'/state',{token:created.token})).body;const r=await request(b.base,prefix+'/action',{method:'POST',token:created.token,body:{kind,stageId:v.public.stageId}});assert.equal(r.status,200);};
    await post('start');
    assert.equal((await request(b.base,prefix+'/state',{token:created.players[0].token})).body.me.role,null);
    await post('screen_next');
    const before=(await request(b.base,prefix+'/state',{token:created.players[0].token})).body;
    await app.close();b=await boot({dataFile:file});app=b.app;
    const after=(await request(b.base,prefix+'/state',{token:created.players[0].token})).body;
    assert.equal(after.public.stage,'dossier');assert.equal(after.public.playMode,'screen-led');assert.deepEqual(after.me,before.me);
    const stream=await fetch(b.base+prefix+`/events?token=${created.players[0].token}`,{signal:abort.signal});
    const reader=stream.body.getReader();let raw='';while(!raw.includes('\n\n'))raw+=new TextDecoder().decode((await reader.read()).value);
    const frame=JSON.parse(raw.split('data: ')[1].split('\n')[0]);
    for(const key of ['opening','briefing','evidence','reasonOptions','result','replay'])assert.equal(key in frame.public,false);
    assert.equal(frame.me.id,after.me.id);assert.ok(!raw.includes(created.token));
    abort.abort();
  }finally{abort.abort();if(app)await app.close();rmSync(temp,{recursive:true,force:true});}
});

test('旧三人存档没有模式标记时保持原流程，重开后采用公共屏模式',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'legacy-save-')),file=join(temp,'rooms.json');let app;
  try{
    const story=loadStories().get('after-closing'),room=createRoom(story.id);
    delete room.playMode;delete room.cardsReleased;
    const players=['旧甲','旧乙','旧丙'].map(n=>joinRoom(room,story,n));
    act(room,story,room.hostToken,{kind:'start',stageId:room.stageId});
    writeFileSync(file,JSON.stringify({version:1,rooms:[room]}));
    const b=await boot({dataFile:file});app=b.app;const prefix=`/api/rooms/${room.code}`;
    const before=(await request(b.base,prefix+'/state',{token:players[0].token})).body;
    assert.equal(before.public.stage,'dossier');assert.equal(before.public.playMode,'classic');assert.ok(before.me.role.dossier);
    for(const kind of ['abort','reset','start']){
      const v=(await request(b.base,prefix+'/state',{token:room.hostToken})).body;
      assert.equal((await request(b.base,prefix+'/action',{method:'POST',token:room.hostToken,body:{kind,stageId:v.public.stageId}})).status,200);
    }
    const after=(await request(b.base,prefix+'/state',{token:players[0].token})).body;
    assert.equal(after.public.stage,'opening');assert.equal(after.public.playMode,'screen-led');assert.equal(after.me.role,null);
  }finally{if(app)await app.close();rmSync(temp,{recursive:true,force:true});}
});
