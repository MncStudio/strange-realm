import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type Room } from 'colyseus.js';
import type { ActionRequest, PrivateSnapshot, PublicSnapshot, SessionInfo } from '../packages/shared/src/index.ts';
const port=Number(process.env.SR_INTEGRATION_PORT??2578); const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['--import','tsx','apps/server/src/index.ts'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let output=''; server.stdout.on('data',chunk=>{output=(output+chunk).slice(-10000);});server.stderr.on('data',chunk=>{output=(output+chunk).slice(-10000);});
interface Connection {room:Room; public?:PublicSnapshot; private?:PrivateSnapshot; session?:SessionInfo; errors:string[]; privateCount:number;closed:boolean}
const connections:Connection[]=[];
async function wait(predicate:()=>unknown|Promise<unknown>,label:string,timeout=12000){const start=Date.now();while(!await predicate()){if(Date.now()-start>timeout)throw new Error(`等待超时：${label}`);await delay(25);}}
async function attach(room:Room){const value:Connection={room,errors:[],privateCount:0,closed:false};connections.push(value);room.onMessage('public',(s:PublicSnapshot)=>value.public=s);room.onMessage('private',(s:PrivateSnapshot)=>{value.private=s;value.privateCount++;});room.onMessage('session',(s:SessionInfo)=>value.session=s);room.onMessage('error',(s:{message:string})=>value.errors.push(s.message));room.onLeave(()=>value.closed=true);room.send('sync');await wait(()=>value.public&&value.session,'同步');return value;}
async function restore(token:string){const start=Date.now();while(true){try{return await attach(await new Client(base).reconnect(token));}catch(error){if((error as {code?:number}).code!==4214||Date.now()-start>2500)throw error;await delay(80);}}}
function privacy(s:PublicSnapshot){if(s.phase==='ended')return;const forbidden=['state','exposure','instruction','symptoms','clues','submittedAction','actionId','role','inventory'];function walk(v:unknown){if(!v||typeof v!=='object')return;for(const [key,value]of Object.entries(v)){assert(!forbidden.includes(key),`公共字段泄露${key}`);walk(value);}}walk(s);assert.deepEqual(s.replay,[]);assert.equal(s.ending,null);}
async function reject(conn:Connection,type:string,value?:unknown){const n=conn.errors.length;conn.room.send(type,value);await wait(()=>conn.errors.length>n,`拒绝${type}`);}
async function staged(conn:Connection,type:string){await delay(120);const n=conn.errors.length;conn.room.send(type,{stageId:conn.public!.stageId});await delay(30);if(conn.errors.length>n)throw new Error(conn.errors.at(-1));}
function check(text:string){console.log(`✓ ${text}`);}
let host:Connection; let players:Connection[]=[];
async function openAction(){const before=host.public!;assert(['introduction','event'].includes(before.phase));if(!before.presentationDone){await staged(host,'presentation_done');await wait(()=>host.public!.presentationDone,'演出完成');}await staged(host,'advance');await wait(()=>host.public!.stageId!==before.stageId,'阶段推进');if(host.public!.phase==='event')await openAction();await wait(()=>players.every(p=>p.public?.stageId===host.public!.stageId&&p.private?.actions.length),'手机选择');}
async function finishResult(){const s=host.public!;assert.equal(s.phase,'resolution');privacy(s);assert(players.every(p=>!JSON.stringify(p.private).includes('"exposure"')));if(!s.presentationDone){await staged(host,'presentation_done');await wait(()=>host.public!.presentationDone,'公共后果播放完毕');}for(const player of players)if(!player.public?.players.find(p=>p.id===player.session?.playerId)?.read)player.room.send('ack_read',{stageId:s.stageId});await wait(()=>host.public!.stageId!==s.stageId,'全员已读推进');}
async function chooseRound(dirty:boolean){const s=host.public!;assert.equal(s.phase,'action');const ids=players.map(p=>p.session!.playerId!);let actor=0;if(!dirty&&s.round===2){actor=players.findIndex(p=>p.private!.instruction?.title!=='门认得你');assert(actor>=0);}const guard=ids.findIndex((_,i)=>i!==actor);
 for(const [i,p]of players.entries()){
  const options=p.private!.actions;let actionId=options.find(a=>a.targetMode==='none')!.id;let targetId:string|undefined;
  if(s.round===1)actionId=dirty&&i===0?'sign_register':'inspect_register';
  if(s.round===2){actionId=i===actor?'answer_door':options.some(a=>a.id==='inspect_knocks')?'inspect_knocks':'inspect_register';if(!dirty&&i===guard){actionId='protect';targetId=ids[actor];}}
  if(s.round===3)actionId=dirty&&i===0?'answer_call':options.some(a=>a.id==='check_recording')?'check_recording':'trace_wires';
  if(s.round===4||s.round===6)actionId=options.some(a=>a.id==='inspect_water')?'inspect_water':options.some(a=>a.id==='resist')?'resist':'verify_echo';
  if(p.private!.instruction?.title==='它不想你洗掉名字'){actionId='protect';targetId=ids.find(id=>id!==p.session!.playerId);}
  if(s.round===5)actionId=options.some(a=>a.id==='verify_mirror')?'verify_mirror':'trace_wires';
  if(s.round===7)actionId=dirty?'direct_leave':'verify_leave';
  const request:ActionRequest={stageId:s.stageId,actionId,...(targetId?{targetId}:{})};assert(options.some(a=>a.id===actionId),`${actionId}必须属于本轮选择`);p.room.send('action',request);
 }
 await wait(()=>host.public!.phase==='resolution','全员提交自动结算');await wait(()=>players.every(p=>p.public?.phase==='resolution'&&p.private?.results.some(r=>r.round===s.round)),'个人结果');
}
try{
 await wait(async()=>{try{return(await fetch(`${base}/api/health`)).ok;}catch{return false;}},'服务启动');
 const scenarios=await fetch(`${base}/api/scenarios`).then(r=>r.json()) as {id:string}[];
 host=await attach(await new Client(base).create('realm',{kind:'host',hostKey:randomUUID(),scenarioId:scenarios[0]!.id}));const roomId=host.room.roomId;const code=host.public!.code;
 for(let i=0;i<6;i++)players.push(await attach(await new Client(base).joinById(roomId,{kind:'player',nickname:`访客${i+1}`})));
 await assert.rejects(new Client(base).joinById(roomId,{kind:'player',nickname:'七'}));await reject(players[0]!,'start');await reject(players[0]!,'ready','true');
 for(const p of players)p.room.send('ready',true);await wait(()=>host.public!.players.every(p=>p.ready),'准备');host.room.send('start');await wait(()=>host.public!.phase==='introduction','开场');
 assert.equal(host.privateCount,0);assert(players.every(p=>p.private!.identity.kind==='ordinary'));privacy(host.public!);check('六位普通访客加入，主持无私人消息，公共投影无感染或指令');
 const hostToken=host.room.reconnectionToken;await host.room.leave(false);host=await restore(hostToken);const playerToken=players[0]!.room.reconnectionToken;await players[0]!.room.leave(false);players[0]=await restore(playerToken);assert.equal(players[0].private!.identity.kind,'ordinary');check('主持和手机重连恢复当前阶段');
 await openAction();const stage=host.public!.stageId;
 await reject(players[0]!,'action',{stageId:stage,actionId:'invented'});await reject(players[0]!,'action',{stageId:stage-1,actionId:'sign_register'});await reject(players[0]!,'action',{stageId:stage,actionId:'sign_register',exposure:3});await reject(players[0]!,'presentation_done',{stageId:stage});await reject(host,'advance',{stageId:stage});
 players[0]!.room.send('action',{stageId:stage,actionId:'sign_register'});await wait(()=>players[0]!.private?.submittedAction,'私人确认');await reject(players[0]!,'action',{stageId:stage,actionId:'sign_register'});
 await staged(host,'skip_disconnected');await delay(600);assert.equal(host.public!.submittedCount,1);assert.equal(host.public!.phase,'action');
 const offline=players[5]!;const token=offline.room.reconnectionToken;await offline.room.leave(false);await wait(()=>host.public!.players.find(p=>p.id===offline.session!.playerId)?.connected===false,'离线');await staged(host,'skip_disconnected');await wait(()=>host.public!.submittedCount===2,'只代选离线者');players[5]=await restore(token);assert.equal(players[5].private!.submittedAction!.actionId,'resist');
 for(const p of players.slice(1,5))p.room.send('action',{stageId:stage,actionId:'inspect_register'});await wait(()=>host.public!.phase==='resolution','第一幕结算');await wait(()=>players[0]!.private?.results.length,'私人回执');assert.equal(players[0]!.private!.identity.kind,'ordinary');assert(!JSON.stringify(players[0]!.private).includes('exposure'));privacy(host.public!);
 await reject(players[0]!,'ack_read',{stageId:host.public!.stageId});await delay(500);assert.equal(host.public!.phase,'resolution');check('阶段、权限与重复校验；潜伏真相不发本人；在线者不能代选');
 while(host.public!.phase!=='ended'){if(host.public!.phase==='resolution')await finishResult();else{await openAction();await chooseRound(true);}}
 assert.equal(host.public!.ending!.id,'carried-out');assert.equal(host.public!.replay.length,7);assert(host.public!.replay.some(r=>r.causes.some(c=>c.title==='真实状态变化')));check('七幕异常携出结局，真实感染与指令仅在终局回放揭晓');
 host.room.send('reset');await wait(()=>host.public!.phase==='lobby','重开');await wait(()=>players.every(p=>p.private?.results.length===0),'清空秘密');for(const p of players)p.room.send('ready',true);await wait(()=>host.public!.players.every(p=>p.ready),'新局准备');host.room.send('start');await wait(()=>host.public!.phase==='introduction','新开场');
 while(host.public!.phase!=='ended'){await openAction();await chooseRound(false);await finishResult();}
 assert.equal(host.public!.ending!.id,'safe-dawn');assert(host.public!.ending!.outcomes.every(p=>p.escaped&&p.identity==='正常人类'));check('六人协作可实现零感染逃脱，不强制产生敌人');
 const obsolete=players[5]!.room.reconnectionToken;await players[5]!.room.leave(false);await wait(()=>host.public!.players.filter(p=>p.connected).length===5,'一人离线');host.room.send('reset');await wait(()=>host.public!.phase==='lobby'&&host.public!.players.length===5,'释放离线席位');await assert.rejects(new Client(base).reconnect(obsolete));
 await Promise.allSettled(connections.filter(c=>!c.closed).map(c=>c.room.leave()));await wait(async()=> (await fetch(`${base}/api/rooms/${code}`)).status===404,'空房销毁');check('重开、旧凭证失效与空房清理');
 console.log('真实Colyseus重构验收通过。');
}catch(error){console.error(error);console.error(output);process.exitCode=1;}finally{await Promise.race([Promise.allSettled(connections.filter(c=>!c.closed).map(c=>c.room.leave())),delay(1000)]);server.kill('SIGTERM');await delay(200);if(server.exitCode===null)server.kill('SIGKILL');}
