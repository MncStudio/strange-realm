import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createGameServer } from '../server.mjs';
import { loadStories } from '../stories.mjs';

const storyId=process.argv[2]||'snow-letter';
const story=loadStories().get(storyId);
assert.ok(story,`未知剧本：${storyId}`);
const resultDir=`test-results/${storyId}`;

if(story.playMode==='screen-led'){
  await import('./screen-browser.mjs');
} else {
const app=createGameServer({dataFile:null});
await new Promise(resolve=>app.server.listen(0,'0.0.0.0',resolve));
const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true});
const errors=[];
const contexts=[];
const watch=page=>{page.on('pageerror',error=>errors.push(error.message));};
const visible=async(locator)=>{await locator.waitFor({state:'visible',timeout:15000});};
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面不应横向溢出');}
async function click(page,name){const b=page.getByRole('button',{name,exact:true});await b.click({timeout:15000});}
try{
  mkdirSync(resultDir,{recursive:true});
  const desktop=await browser.newContext({viewport:{width:1440,height:960}});contexts.push(desktop);
  const host=await desktop.newPage();watch(host);await host.goto(base);
  await host.getByLabel('选择今晚的故事').selectOption(storyId);
  await visible(host.getByRole('button',{name:/创建公共屏/}));await noOverflow(host);
  await host.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await host.locator('.letter').evaluate(el=>getComputedStyle(el).animationName),'none');
  await host.keyboard.press('Tab');await host.keyboard.press('Tab');
  assert.ok(await host.evaluate(()=>parseInt(getComputedStyle(document.activeElement).outlineWidth,10)>=2),'键盘焦点应清楚可见');
  await host.screenshot({path:`${resultDir}/home.png`,fullPage:true});
  await host.getByRole('button',{name:/创建公共屏/}).click();await host.waitForURL(/screen=host/);
  const code=new URL(host.url()).searchParams.get('room');assert.match(code,/^\d{6}$/);
  await visible(host.getByRole('heading',{name:'扫码入席'}));
  await host.screenshot({path:`${resultDir}/lobby.png`,fullPage:true});
  const qr=host.locator('img.qr');await qr.waitFor();assert.ok(await qr.evaluate(img=>img.complete&&img.naturalWidth>0));
  const phones=[];
  for(let i=0;i<story.players;i++){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});contexts.push(context);
    const page=await context.newPage();watch(page);await page.goto(`${base}/?room=${code}`);
    await page.getByLabel('朋友们怎么称呼你？').fill(`手机${i+1}`);
    await page.getByRole('button',{name:/^入席/}).click();
    await visible(page.getByRole('heading',{name:`手机${i+1}，你已入席。`}));phones.push(page);
  }
  await host.getByRole('button',{name:'所有人到齐，开始分发角色'}).click();
  const names=[];
  for(const page of phones){await visible(page.locator('.role-name'));names.push(await page.locator('.role-name').innerText());await noOverflow(page);}
  assert.equal(new Set(names).size,story.players);
  assert.deepEqual(names,phones.map((_,i)=>`手机${i+1}`),'角色主名应直接使用入席昵称');
  assert.equal(await host.getByText('你是本案凶手',{exact:true}).count(),0);
  await phones[0].screenshot({path:`${resultDir}/phone-dossier.png`,fullPage:true});
  await phones[0].setViewportSize({width:320,height:740});await noOverflow(phones[0]);
  await phones[0].screenshot({path:`${resultDir}/phone-320.png`,fullPage:true});
  await phones[0].setViewportSize({width:390,height:844});
  for(const page of phones)await click(page,'档案读完了');
  await phones[0].reload();await visible(phones[0].getByRole('button',{name:'开场与规则已读，开始调查'}));
  assert.ok(!(await phones[0].locator('#app').innerText()).includes('{{role:'));
  if(storyId==='after-closing')for(let i=0;i<story.players;i++)assert.ok((await phones[0].locator('.prose').innerText()).includes(`手机${i+1}`));
  for(const page of phones)await click(page,'开场与规则已读，开始调查');
  for(let round=1;round<=2;round++){
    for(let i=0;i<story.players;i++)await phones[i].locator('.location').nth(i%story.locations.length).click();
    if(round===1){
      await click(phones[0],'公开物证');await click(phones[0],'引用这条线索提问');
      await visible(phones[0].getByRole('dialog'));await phones[0].locator('#confirm-ok').click();
      await visible(host.getByText(`用 ${story.evidence[0].id} 询问`,{exact:false}));
      await noOverflow(phones[0]);
      await phones[0].screenshot({path:`${resultDir}/phone-evidence.png`,fullPage:true});
      await phones[0].locator('.evidence summary').first().click();
      await click(phones[0],'本轮讨论完成，准备继续');await visible(phones[0].getByRole('button',{name:'撤回完成状态',exact:true}));
      await click(phones[1],'公开物证');await visible(phones[0].getByRole('button',{name:'本轮讨论完成，准备继续',exact:true}));
      assert.equal(await phones[0].locator('.evidence').first().getAttribute('open'),null,'实时更新不应强制展开已经收起的物证');
    }
    for(const page of phones)await click(page,'本轮讨论完成，准备继续');
    if(round===1){
      await visible(host.getByRole('heading',{name:'第二轮 · 核对时间'}));
      await host.screenshot({path:`${resultDir}/public-screen.png`,fullPage:true});
      await phones[0].screenshot({path:`${resultDir}/phone-investigation.png`,fullPage:true});
      await host.setViewportSize({width:1280,height:720});await host.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await noOverflow(host);
      const roster=await host.locator('.players-card').boundingBox();assert.ok(roster&&roster.y+roster.height<=720,'16:9公屏首屏应能看到所有玩家状态');
      await host.screenshot({path:`${resultDir}/public-1280.png`});
      await host.locator('.host-main .evidence summary').first().focus();await host.keyboard.press('Enter');
      assert.equal(await host.locator('.host-main .evidence').first().getAttribute('open'),'');
      await host.keyboard.press('Enter');
      await host.setViewportSize({width:1440,height:960});
    }
  }
  for(const page of phones){await click(page,'我已完成提问或陈述／放弃发言');await click(page,'我准备好秘密指认了');}
  const player0Token=await phones[0].evaluate(code=>JSON.parse(localStorage.getItem(`sr:p:${code}`)).token,code);
  for(let i=0;i<story.players;i++){
    const page=phones[i];await visible(page.getByLabel('选择故事人物'));await page.getByLabel('选择故事人物').selectOption(story.answer.culpritId);
    await page.locator(`input[name=reasonId][value=${story.answer.reasonId}]`).check();await page.locator(`input[name=testify][value=${i%2===0?'true':'false'}]`).check();
    await click(page,'秘密提交我的指认');
    if(i===0){
      await page.reload();await visible(page.getByRole('button',{name:'修改我的指认'}));
      assert.equal(await page.getByLabel('选择故事人物').inputValue(),story.answer.culpritId);
      const response=await fetch(`${base}/api/rooms/${code}/state`,{headers:{Authorization:`Bearer ${player0Token}`}});const value=await response.json();assert.equal(value.public.result,null);
    }
  }
  await visible(host.getByRole('heading',{name:'正确指认',exact:true}));
  const downloaded=host.waitForEvent('download');await click(host,'保存这局复盘');const download=await downloaded;
  assert.match(download.suggestedFilename(),/复盘.json$/);await download.saveAs(`${resultDir}/replay.json`);
  const savedReplay=readFileSync(`${resultDir}/replay.json`,'utf8');assert.ok(!savedReplay.includes(player0Token));assert.ok(!savedReplay.includes('hostToken'));assert.equal(JSON.parse(savedReplay).result.key,'solved');
  assert.ok(!savedReplay.includes('{{role:'));
  for(const player of JSON.parse(savedReplay).result.players)assert.equal(player.name,player.nickname);
  await noOverflow(phones[0]);
  await click(host,'回到大厅，再开一局');await host.locator('#confirm-ok').click();
  await visible(host.getByRole('button',{name:'所有人到齐，开始分发角色'}));
  await visible(phones[0].getByRole('heading',{name:'手机1，你已入席。'}));
  console.log(`通过：《${story.title}》${story.players}个独立手机浏览器加入、不同角色、两轮搜证、公开与提问、自动推进、刷新恢复、秘密投票、结局、下载与重开。`);

  // 单窗口试玩也必须通过同样的角色凭证和服务端校验。
  await host.goto(base);await host.getByLabel('选择今晚的故事').selectOption(storyId);await click(host,'一个人试完整流程');
  await visible(host.getByText(`你会在一个页面中切换全部${story.players}个角色。`,{exact:false}));
  await host.locator('#confirm-ok').click();await host.waitForURL(/demo=/);
  assert.equal(await host.locator('#demo-player option').count(),story.players);
  await visible(host.getByRole('button',{name:'开始分发角色',exact:true}));
  await host.locator('[data-do=demo-others]').click();
  const phone=host.locator('.phone-pane');
  await visible(phone.locator('.role-name'));
  await host.screenshot({path:`${resultDir}/demo-dossier.png`,fullPage:true});
  const firstName=await phone.locator('.role-name').innerText();
  await host.locator('#demo-player').selectOption('1');await visible(phone.locator('.role-name'));
  assert.notEqual(await phone.locator('.role-name').innerText(),firstName);
  for(const name of ['档案读完了','开场与规则已读，开始调查']){await phone.getByRole('button',{name,exact:true}).click();await host.locator('[data-do=demo-others]').click();}
  for(let round=1;round<=2;round++){await phone.locator('.location').nth(1).click();await phone.getByRole('button',{name:'本轮讨论完成，准备继续',exact:true}).click();await host.locator('[data-do=demo-others]').click();}
  await phone.getByRole('button',{name:'我已完成提问或陈述／放弃发言',exact:true}).click();await phone.getByRole('button',{name:'我准备好秘密指认了',exact:true}).click();await host.locator('[data-do=demo-others]').click();
  await host.locator('[data-do=demo-others]').click();
  await visible(host.getByRole('alert').filter({hasText:`其余${story.players-1}人`}));
  await phone.getByLabel('选择故事人物').selectOption(story.answer.culpritId);await phone.locator(`input[name=reasonId][value=${story.answer.reasonId}]`).check();await phone.locator('input[name=testify][value=true]').check();await phone.getByRole('button',{name:'秘密提交我的指认',exact:true}).click();
  await host.locator('[data-do=demo-others]').click();await visible(phone.getByRole('heading',{name:'正确指认',exact:true}));
  await noOverflow(host);await host.screenshot({path:`${resultDir}/demo-ending.png`,fullPage:true});
  console.log(`通过：一个窗口切换角色、自动完成其余${story.players-1}席、整局到结尾。`);
  assert.deepEqual(errors,[],'浏览器不应出现脚本错误');
  console.log('通过：1280×720公屏玩家状态首屏可见；320/390px手机无横向溢出；键盘焦点、物证展开与减少动态设置通过，浏览器脚本错误为零。');
}catch(error){
  for(const [i,context] of contexts.entries())for(const page of context.pages())try{await page.screenshot({path:`${resultDir}/failure-${i}.png`,fullPage:true});}catch{}
  throw error;
}finally{await browser.close();await app.close();}

}
