import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page, type Browser } from 'playwright';

const webPort = Number(process.env.SR_BROWSER_WEB_PORT ?? 5183);
const serverPort = Number(process.env.SR_BROWSER_SERVER_PORT ?? 2588);
const base = `http://127.0.0.1:${webPort}`;
const backend = `http://127.0.0.1:${serverPort}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  env: { ...process.env, PORT: String(serverPort), WEB_PORT: String(webPort) }, stdio: ['ignore', 'pipe', 'pipe']
});
const web = spawn(process.execPath, ['apps/web/node_modules/vite/bin/vite.js', 'apps/web'], {
  env: { ...process.env, SR_WEB_PORT: String(webPort), SR_API_TARGET: backend, VITE_SERVER_URL: backend.replace('http', 'ws') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = ''; let browser: Browser | undefined;
const consoleErrors: string[] = [];
for (const proc of [server, web]) {
  proc.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
  proc.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
}
async function ready(url: string) {
  const started = Date.now();
  while (true) {
    try { if ((await fetch(url)).ok) return; } catch { /* Keep checking the owned startup process. */ }
    if (Date.now() - started > 15000) throw new Error(`服务启动超时 ${url}`);
    await delay(150);
  }
}
async function pageFor(width: number, height: number) {
  const context = await browser!.newContext({ viewport: { width, height }, locale: 'zh-CN', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.text()} ${msg.location().url}`); });
  return page;
}
async function noOverflow(page: Page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '页面不应横向溢出');
}
try {
  await Promise.all([ready(`${backend}/api/health`), ready(`${base}/api/scenarios`)]);
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  await mkdir('test-results', { recursive: true });
  const host = await pageFor(1600, 900);
  await host.goto(base);
  await host.getByRole('link', { name: /创建游戏/ }).waitFor();
  await host.waitForFunction(() => !!document.querySelector<HTMLImageElement>('.scene-photo')?.naturalWidth);
  assert(await host.locator('.scene-photo').evaluate(img => getComputedStyle(img).animationName !== 'none'), '场景图片具有慢速动效');
  await host.getByTestId('motion-toggle').click();
  assert(await host.locator('.scene-photo').evaluate(img => getComputedStyle(img).animationName === 'none'), '关闭动效后停止动画');
  await host.reload();
  await host.waitForFunction(() => !!document.querySelector<HTMLImageElement>('.scene-photo')?.naturalWidth);
  assert.equal(await host.getByTestId('motion-toggle').innerText(), '动效关闭', '刷新保留动效偏好');
  await host.getByTestId('motion-toggle').click();
  await host.emulateMedia({ reducedMotion: 'reduce' });
  assert(await host.locator('.scene-photo').evaluate(img => getComputedStyle(img).animationName === 'none'), '尊重系统减少动态设置');
  await host.emulateMedia({ reducedMotion: 'no-preference' });
  await noOverflow(host);
  await host.screenshot({ path: 'test-results/home.png', fullPage: true });
  await host.getByRole('link', { name: /创建游戏/ }).click();
  await host.getByRole('button', { name: '创建房间 →', exact: true }).click();
  await host.waitForURL(/\/room\//);
  await host.locator('.room-code-block strong').waitFor();
  const code = (await host.locator('.room-code-block strong').innerText()).trim();
  assert.match(code, /^[A-Z2-9]{6}$/);
  await host.getByAltText('扫码加入当前房间').waitFor();
  await host.screenshot({ path: 'test-results/host-lobby.png', fullPage: true });
  const players: Page[] = [];
  for (let i = 0; i < 4; i++) {
    const page = await pageFor(390, 844);
    players.push(page);
    await page.goto(`${base}/join?code=${code}`);
    await page.getByLabel('你的昵称', { exact: true }).fill(`浏览器访客${i + 1}`);
    await page.getByRole('button', { name: '进入房间 →', exact: true }).click();
    await page.waitForURL(/\/room\//);
    await noOverflow(page);
    await page.getByRole('button', { name: '我已准备 →', exact: true }).click();
  }
  const start = host.getByRole('button', { name: '开始游戏 →', exact: true });
  await start.waitFor();
  await host.waitForFunction(() => !(Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('开始游戏')) as HTMLButtonElement | undefined)?.disabled);
  await start.click();
  await host.getByTestId('begin-action').waitFor();
  for (const page of players) {
    await page.getByTestId('identity-label').waitFor();
    assert.equal((await page.getByTestId('identity-label').innerText()).trim(), '普通访客');
    assert(!(await page.locator('body').innerText()).includes('物品线索'));
    await noOverflow(page);
  }
  await players[0].screenshot({ path: 'test-results/player-identity.png', fullPage: true });
  await host.reload();
  await host.getByTestId('begin-action').waitFor();
  await players[0].reload();
  await players[0].getByTestId('identity-label').waitFor();
  await host.evaluate(() => {
    (window as unknown as Record<string, unknown>).__nativeAudioContext = window.AudioContext;
    window.AudioContext = class { constructor() { throw new Error('simulated blocked sound'); } } as unknown as typeof AudioContext;
  });
  await host.getByRole('button', { name: '点击启用现场声音', exact: true }).click();
  await host.getByText('此设备无法播放声音，使用字幕继续。', { exact: true }).waitFor();
  await host.evaluate(() => { window.AudioContext = (window as unknown as { __nativeAudioContext: typeof AudioContext }).__nativeAudioContext; });
  await host.getByRole('button', { name: '点击启用现场声音', exact: true }).click();
  await host.getByRole('button', { name: '声音开启 · 点此静音', exact: true }).waitFor();
  assert.equal(await host.getByLabel('现场音量').getAttribute('max'), '0.5');
  await host.getByTestId('begin-action').click();
  for (let round = 1; round <= 7; round++) {
    await host.locator('.host-screen[data-phase="event"]').waitFor();
    await host.getByTestId('begin-action').click();
    await host.locator('.host-screen[data-phase="action"]').waitFor();
    for (const page of players) await page.locator('.action-options').waitFor();
    let actor = 0;
    if (round === 2) {
      for (let i = 0; i < players.length; i++) {
        const text = await players[i].locator('body').innerText();
        if (!text.includes('门认得你')) { actor = i; break; }
      }
    }
    const guardian = players.findIndex((_page,i)=>i!==actor);
    for (const [i,page] of players.entries()) {
      await page.locator('.action-options').waitFor();
      const count = await page.locator('.action-option').count(); assert(count >= 2 && count <= 3);
      let action = round === 1 ? 'inspect_register' : round === 2 ? (i === actor ? 'answer_door' : i === guardian ? 'protect' : 'inspect_knocks') : round === 3 ? 'check_recording' : round === 4 ? 'inspect_water' : round === 5 ? 'verify_mirror' : round === 6 ? 'resist' : 'verify_leave';
      if ((await page.locator('body').innerText()).includes('它不想你洗掉名字')) action = 'protect';
      await page.getByTestId(`action-${action}`).click();
      if (action === 'protect') {
        const labels = await page.locator('#action-target option:not([disabled])').allTextContents();
        const name = round === 2 ? `浏览器访客${actor + 1}` : labels[0];
        await page.locator('#action-target').selectOption({ label: name });
      }
      await noOverflow(page);
      if (round === 2 && i === 0) await page.screenshot({ path:'test-results/player-choices.png',fullPage:true });
      await page.getByTestId('submit-action').click();
    }
    await host.getByTestId('round-report').waitFor();
    for (const page of players) await page.getByTestId('personal-round-result').waitFor();
    if (round === 1) {
      await host.screenshot({ path:'test-results/host-round-report.png',fullPage:true });
      await players[0].screenshot({ path:'test-results/player-round-report.png',fullPage:true });
    }
    for (const page of players.slice(0,3)) await page.getByTestId('ack-read').click();
    assert.equal(await host.locator('.host-screen').getAttribute('data-phase'),'resolution','少一人已读不能跳转');
    await players[3].getByTestId('ack-read').click();
  }
  await host.locator('.ending-screen').waitFor();
  const downloadPromise = host.waitForEvent('download');
  await host.getByTestId('save-replay').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^strange-realm-story-[A-Z2-9]{6}\.json$/);
  await download.saveAs('test-results/browser-story.json');
  const recordText = await readFile('test-results/browser-story.json', 'utf8');
  const record = JSON.parse(recordText);
  assert.equal(record.format, 'strange-realm-story-v1');
  assert.equal(record.replay.length, 7);
  assert.equal(record.ending.outcomes.length, 4);
  assert(record.replay.every((entry: { actions: unknown[]; causes: unknown[] }) => entry.actions.length === 4 && Array.isArray(entry.causes)));
  assert(!/reconnectionToken|hostKey|sessionStorage/.test(recordText), '回放不导出凭证或完整客户端会话');
  await host.screenshot({ path: 'test-results/ending.png', fullPage: true });
  await players[0].screenshot({ path: 'test-results/player-ending.png', fullPage: true });
  await noOverflow(players[0]);
  await host.getByRole('button', { name: /返回大厅|再来一局|重新开局/ }).click();
  await host.locator('.room-code-block').waitFor();
  for (const page of players) await page.getByRole('button', { name: '我已准备 →', exact: true }).waitFor();
  assert.equal(consoleErrors.length, 0, `浏览器错误：${consoleErrors.join('\n')}`);
  console.log('✓ 四位普通访客、2～3选择、全员已读、声音失败回退/手动启用、七幕回放导出与重开，无溢出或浏览器错误');
  console.log('截图：test-results/');
} catch (error) {
  console.error(error); console.error(output); process.exitCode = 1;
} finally {
  await browser?.close();
  for (const proc of [server, web]) proc.kill('SIGTERM');
  await delay(200);
  for (const proc of [server, web]) if (proc.exitCode === null) proc.kill('SIGKILL');
}
