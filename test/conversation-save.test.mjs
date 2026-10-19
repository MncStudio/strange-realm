import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadStories } from '../stories.mjs';
import { createRoom, joinRoom, act } from '../engine.mjs';
import { createGameServer } from '../server.mjs';

async function session(file){
  const app=createGameServer({dataFile:file});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,token,body)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.ok,true,await response.clone().text());return response.json();
  };
  return {app,base,request};
}
test('没有流程版本的旧公共屏存档继续用原文与登记机制，重开才切换交谈模式',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'sr-conversation-legacy-')),file=join(temp,'rooms.json');let app;
  try{
    const story=loadStories(undefined,'story.v1.json').get('after-closing');
    const room=createRoom(story.id,{playMode:'screen-led'});delete room.flowVersion;
    const players=['甲','乙','丙'].map(n=>joinRoom(room,story,n));
    const action=kind=>act(room,story,room.hostToken,{kind,stageId:room.stageId});
    action('start');action('screen_next');action('screen_next');
    writeFileSync(file,JSON.stringify({version:1,rooms:[room]}));
    const s=await session(file);app=s.app;const path=`/api/rooms/${room.code}`;
    let view=await s.request(path+'/state',room.hostToken);
    assert.equal(view.public.flowVersion,1);assert.equal(view.public.evidence.length,0);assert.equal(view.public.briefing.background,story.briefing.background);
    for(const kind of ['abort','reset','start','screen_next','screen_next']){
      view=await s.request(path+'/action',room.hostToken,{kind,stageId:view.public.stageId});
    }
    assert.equal(view.public.flowVersion,2);assert.equal(view.public.stage,'search1');assert.equal(view.public.evidence.length,3);
    const phone=await s.request(path+'/state',players[0].token);assert.ok(phone.me.role.card.starter);assert.deepEqual(phone.me.responseHints,[]);
    assert.equal((await fetch(s.base+'/stories/after-closing/story.v1.json')).status,404);
  }finally{if(app)await app.close();rmSync(temp,{recursive:true,force:true});}
});
test('新局重启保留已公开材料和主动核验，未来核验与私卡仍隔离',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'sr-conversation-save-')),file=join(temp,'rooms.json');let app;
  try{
    let s=await session(file);app=s.app;const created=await s.request('/api/demo',null,{storyId:'mermaid-letter'}),path=`/api/rooms/${created.code}`;
    let view=await s.request(path+'/state',created.token);
    for(const kind of ['start','screen_next','screen_next','screen_next'])view=await s.request(path+'/action',created.token,{kind,stageId:view.public.stageId});
    assert.ok(!('verification' in view.public.evidence.find(e=>e.id==='M07')));
    view=await s.request(path+'/action',created.token,{kind:'screen_verify',evidenceId:'M07',stageId:view.public.stageId});
    const phoneBefore=await s.request(path+'/state',created.players[0].token);
    await app.close();s=await session(file);app=s.app;
    const restored=await s.request(path+'/state',created.token),phoneAfter=await s.request(path+'/state',created.players[0].token);
    assert.deepEqual(restored,view);assert.deepEqual(phoneAfter,phoneBefore);
    assert.equal(restored.public.flowVersion,2);assert.ok(restored.public.evidence.find(e=>e.id==='M07').verification);
    assert.ok(!('evidence' in phoneAfter.public));assert.ok(!('focus' in phoneAfter.me.role.card));
  }finally{if(app)await app.close();rmSync(temp,{recursive:true,force:true});}
});
