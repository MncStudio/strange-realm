import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createGameServer } from '../server.mjs';
import { loadStories } from '../stories.mjs';

const storyId=process.argv[2]||'after-closing',story=loadStories().get(storyId);
assert.equal(story.flowVersion,2);
const count=story.players,word=['零','一','二','三','四','五','六','七','八'][count];
const innocent=story.roles.find(r=>!r.isCulprit).id;
const app=createGameServer({dataFile:null});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true}),errors=[],pages=[];
const dir=`test-results/${storyId}/conversation`;mkdirSync(dir,{recursive:true});
const visible=locator=>locator.waitFor({state:'visible',timeout:15000});
const click=(surface,name)=>surface.getByRole('button',{name,exact:true}).click();
const noOverflow=async page=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
async function pageAt(viewport){const page=await (await browser.newContext({viewport})).newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));return page;}
async function selectStory(page){await page.goto(base);await page.getByLabel('选择今晚的故事').selectOption(storyId);}
async function assertConversation(surface,round){
  await visible(surface.getByRole('heading',{name:story.conversation.beats[round===1?'search1':'search2'].title,exact:true}));
  assert.equal(await surface.locator('.evidence').count(),round*story.locations.length);
  assert.equal(await surface.locator('[data-do=screen_search],[data-do=screen_speak],#screen-investigator,.stage-meter').count(),0);
  assert.equal(await surface.locator('.question').count(),0);
}
async function fillBallots(surface){
  assert.equal(await surface.locator('select[name^="reason-"]').count(),0);
  const suspects=surface.locator('select[name^="suspect-"]');
  for(let i=0;i<count;i++)await suspects.nth(i).selectOption(i===count-1?innocent:story.answer.culpritId);
  await surface.getByLabel(`${word}张选票已经收齐并同时揭开，录入内容与纸票一致。`).check();
}
try{
  const host=await pageAt({width:1440,height:960});await selectStory(host);await click(host,'创建公共屏');await host.waitForURL(/screen=host/);
  const code=new URL(host.url()).searchParams.get('room'),phones=[];
  for(let i=0;i<count;i++){
    const phone=await pageAt({width:390,height:844});await phone.goto(`${base}/?room=${code}`);
    await phone.getByLabel('朋友们怎么称呼你？').fill(`玩家${i+1}`);await phone.getByRole('button',{name:/^入席/}).click();
    await visible(phone.getByText('私人身份尚未发放。刷新后仍会回到自己的席位。'));phones.push(phone);
  }
  await click(host,'所有人到齐，一起听故事');await visible(host.getByRole('button',{name:'领取私人身份',exact:true}));
  assert.equal(await host.getByText('你是凶手',{exact:true}).count(),0);
  await noOverflow(host);await host.screenshot({path:`${dir}/opening.png`,fullPage:true});
  await click(host,'领取私人身份');
  for(const [i,phone] of phones.entries()){
    await visible(phone.locator('.single-purpose'));assert.equal(await phone.locator('.role-name').innerText(),`玩家${i+1}`);
    assert.equal(await phone.locator('.action-facts li').count(),3);assert.equal(await phone.locator('.current-direction,.tabs,.evidence,[data-do]').count(),0);
    assert.equal(await phone.locator('[data-detail=private-starter]').getAttribute('open'),null);
    const token=await phone.evaluate(code=>JSON.parse(localStorage.getItem(`sr:p:${code}`)).token,code);
    const v=await (await fetch(`${base}/api/rooms/${code}/state`,{headers:{Authorization:`Bearer ${token}`}})).json();
    assert.equal(v.public.flowVersion,2);assert.deepEqual(v.me.responseHints,[]);
    for(const key of ['opening','briefing','evidence','discussion','players','result','reasonOptions'])assert.equal(key in v.public,false);
  }
  await phones[0].screenshot({path:`${dir}/private-390.png`,fullPage:true});
  await phones[0].locator('[data-detail=private-starter] summary').click();await phones[0].reload();await visible(phones[0].locator('.single-purpose'));
  await phones[0].setViewportSize({width:320,height:740});await noOverflow(phones[0]);await phones[0].screenshot({path:`${dir}/private-320.png`,fullPage:true});
  await click(host,'听完介绍，看看现场发现');await assertConversation(host,1);
  assert.equal(await host.locator('[data-detail=conversation-help]').getAttribute('open'),null);
  await host.locator('[data-detail=conversation-help] summary').click();await click(host,'全桌需要一条提示');await host.locator('#confirm-ok').click();await visible(host.getByText(story.hints[0],{exact:true}));
  await host.setViewportSize({width:1280,height:720});await noOverflow(host);await host.screenshot({path:`${dir}/discussion-1280.png`,fullPage:true});
  await click(host,'聊过这一轮，看看新发现');await assertConversation(host,2);
  const verification=story.evidence.find(e=>e.verification);
  await host.locator(`[data-detail="ev-${verification.id}-pub"]`).getByRole('button',{name:'核对这件原物'}).click();
  await visible(host.getByText('核对结果：',{exact:false}));await host.reload();await assertConversation(host,2);
  await visible(host.getByText('核对结果：',{exact:false}));
  for(const phone of phones)assert.equal(await phone.locator('.evidence,.current-direction,[data-detail=response-directions]').count(),0);
  await click(host,'讨论好了，开始指认');await visible(host.getByRole('heading',{name:'你认为凶手是谁？',exact:true}));
  assert.ok(!(await host.locator('#app').innerText()).includes('关键判断'));assert.equal(await host.locator('.paper-reasons').count(),0);
  await host.evaluate(()=>{window.print=()=>{window.printCalls=(window.printCalls||0)+1;};});await click(host,`打印${word}张选票`);
  assert.equal(await host.locator('#print-ballots article').count(),count);assert.ok(!(await host.locator('#print-ballots').innerText()).includes('判断'));
  await host.emulateMedia({media:'print'});assert.equal(await host.locator('#app').isVisible(),false);await host.screenshot({path:`${dir}/print.png`,fullPage:true});await host.emulateMedia({media:'screen'});
  await click(host,'选票已全部揭开，开始录入');await host.locator('select[name^="suspect-"]').first().selectOption(story.answer.culpritId);
  await host.reload();await visible(host.getByRole('heading',{name:'逐张核对纸票',exact:true}));assert.equal(await host.locator('select[name^="suspect-"]').first().inputValue(),story.answer.culpritId);
  await click(host,`${word}张纸票核对无误，揭晓结果`);assert.equal(await host.getByRole('heading',{name:'正确指认',exact:true}).count(),0);
  await fillBallots(host);await host.screenshot({path:`${dir}/vote.png`,fullPage:true});await click(host,`${word}张纸票核对无误，揭晓结果`);await host.locator('#confirm-ok').click();
  await visible(host.getByRole('heading',{name:'正确指认',exact:true}));assert.ok(!(await host.locator('#app').innerText()).includes('判断undefined'));
  for(const phone of phones)assert.equal(await phone.locator('.results-title').count(),0);
  const downloadEvent=host.waitForEvent('download');await click(host,'保存这局复盘');await (await downloadEvent).saveAs(`${dir}/replay.json`);
  const raw=readFileSync(`${dir}/replay.json`,'utf8'),replay=JSON.parse(raw);assert.ok(!raw.includes('hostToken'));assert.ok(!raw.includes('{{role:'));assert.equal(replay.result.completeVotes,count-1);assert.ok(replay.result.players.every(p=>Object.keys(p.ballot).join()==='suspectId'));
  await click(host,'回到大厅，再开一局');await host.locator('#confirm-ok').click();await visible(host.getByRole('button',{name:'所有人到齐，一起听故事',exact:true}));
  await visible(phones[0].getByText('私人身份尚未发放。刷新后仍会回到自己的席位。'));
  console.log(`通过：《${story.title}》${count}部独立手机、公屏分批发证、可选提示与核验、仅投凶手、打印、草稿恢复、复盘与重开。`);
  await selectStory(host);await click(host,'一个人试完整流程');await host.locator('#confirm-ok').click();await host.waitForURL(/demo=/);
  const left=host.locator('.host-pane'),right=host.locator('.phone-pane');
  await click(left,'所有人到齐，一起听故事');await click(left,'领取私人身份');await visible(right.locator('.role-name'));
  const previous=await right.locator('.role-name').innerText();await host.locator('#demo-player').selectOption('1');await host.waitForFunction(previous=>document.querySelector('.phone-pane .role-name')?.textContent!==previous,previous);
  await click(left,'听完介绍，看看现场发现');await assertConversation(left,1);await click(left,'聊过这一轮，看看新发现');await assertConversation(left,2);await click(left,'讨论好了，开始指认');
  await click(left,'选票已全部揭开，开始录入');await fillBallots(left);await click(left,`${word}张纸票核对无误，揭晓结果`);await host.locator('#confirm-ok').click();await visible(left.getByRole('heading',{name:'正确指认',exact:true}));
  await noOverflow(host);await host.screenshot({path:`${dir}/demo-ending.png`,fullPage:true});assert.deepEqual(errors,[]);
  console.log(`通过：《${story.title}》单窗口全局不调用提示或核验也可结算；320/390px手机与1280px公屏无溢出，浏览器错误为零。`);
}catch(error){for(const [i,page]of pages.entries())try{await page.screenshot({path:`${dir}/failure-${i}.png`,fullPage:true});}catch{}throw error;}
finally{await browser.close();await app.close();}
