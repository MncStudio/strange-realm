import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from 'playwright';

const args = process.argv.slice(2);
const count = Number(args.find(arg => arg.startsWith('--players='))?.split('=')[1] ?? 4);
const smoke = args.includes('--smoke');
const webPort = Number(process.env.SR_DEMO_WEB_PORT ?? 5185);
const serverPort = Number(process.env.SR_DEMO_SERVER_PORT ?? 2589);
assert(Number.isInteger(count) && count >= 4 && count <= 6, '模拟人数必须为4～6');
for (const port of [webPort, serverPort]) assert(Number.isInteger(port) && port > 1024 && port < 65536, '无效的测试端口');
await Promise.all([webPort, serverPort].map(port => new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () => reject(new Error(`测试端口 ${port} 已占用，请先关闭旧试玩。`)));
  probe.listen(port, '0.0.0.0', () => probe.close(() => resolve()));
})));
const base = `http://127.0.0.1:${webPort}`;
const backend = `http://127.0.0.1:${serverPort}`;
const processes = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { env: { ...process.env, PORT: String(serverPort), WEB_PORT: String(webPort), SR_TEST_MODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }),
  spawn(process.execPath, ['apps/web/node_modules/vite/bin/vite.js', 'apps/web'], { env: { ...process.env, SR_WEB_PORT: String(webPort), SR_API_TARGET: backend, VITE_SERVER_URL: backend.replace('http', 'ws'), VITE_TEST_MODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
];
let browser: Browser | undefined;
let output = ''; let stopped = false; let finish: () => void = () => {};
for (const proc of processes) {
  proc.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
  proc.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopped = true; finish(); });
async function ready(url: string) {
  const start = Date.now();
  while (!stopped) {
    try { if ((await fetch(url)).ok) return; } catch { /* Waiting for owned server. */ }
    if (Date.now() - start > 15000) throw new Error(`服务启动超时 ${url}`);
    await delay(150);
  }
  throw new Error('试玩已关闭');
}
try {
  await Promise.all([ready(`${backend}/api/health`), ready(`${base}/api/scenarios`)]);
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: smoke, ...(existsSync(chrome) ? { executablePath: chrome } : {}), args: ['--window-size=1440,1000'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/demo?players=${count}`);
  await page.waitForFunction(() => !(document.querySelector('[data-testid="demo-next"]') as HTMLButtonElement | null)?.disabled && !!document.querySelector('[data-testid="demo-next"]'), undefined, { timeout: 20000 });
  console.log(`\n单窗口试玩已就绪：${base}/demo，你＋${count - 1}位自动同伴。`);
  console.log('逐步点击按钮走流程。每轮结果停留，读完后确认继续。关闭窗口或Ctrl+C退出。\n');
  if (smoke) {
    assert.equal(context.pages().length, 1, '只能打开一个页面');
    await page.getByTestId('demo-next').click();
    await page.getByTestId('identity-label').waitFor();
    assert.equal(await page.getByTestId('identity-label').count(), 1, '只展示自己一个秘密身份');
    const role = await page.getByTestId('identity-label').innerText();
    assert.equal(role, '普通访客', '全部普通人开局');
    assert(!(await page.getByTestId('demo-host').innerText()).includes('你收到了一条私人指令'));
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/demo-single-window.png', fullPage: true });
    await page.getByTestId('demo-next').click();
    await page.getByTestId('demo-next').click();
    await page.getByTestId('action-inspect_register').click();
    await page.getByTestId('submit-action').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="demo-phase"]')?.textContent === '查看本轮结果');
    console.log('✓ 单页面、普通人开局、手动行动后同伴自动提交');
    await page.getByTestId('demo-host').getByTestId('round-report').waitFor();
    await page.getByTestId('personal-round-result').waitFor();
    await delay(1200);
    assert.equal(await page.getByTestId('demo-phase').innerText(), '查看本轮结果', '读结果时不可自动推进');
    await page.screenshot({ path: 'test-results/demo-round-report.png', fullPage: true });
    for (let step = 0; step < 30 && await page.getByTestId('demo-phase').innerText() !== '结局与身份揭晓'; step++) {
      const before = await page.getByTestId('demo-phase').innerText();
      await page.waitForFunction(() => !(document.querySelector('[data-testid="demo-next"]') as HTMLButtonElement)?.disabled);
      await page.getByTestId('demo-next').click();
      await page.waitForFunction(label => document.querySelector('[data-testid="demo-phase"]')?.textContent !== label || !!document.querySelector('.global-error'), before);
      assert.equal(await page.locator('.global-error').count(), 0, await page.locator('.global-error').allTextContents().then(values => values.join(' ')));
      if (before === '讨论与秘密选择') {
        await page.getByTestId('demo-host').getByTestId('round-report').waitFor(); await page.getByTestId('personal-round-result').waitFor();
      }
    }
    assert.equal(await page.getByTestId('demo-phase').innerText(), '结局与身份揭晓');
    await page.locator('.ending-screen').waitFor();
    await page.screenshot({ path: 'test-results/demo-single-ending.png', fullPage: true });
    await page.getByTestId('demo-next').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="demo-phase"]')?.textContent === '入场就绪');
    await page.getByTestId('demo-next').click();
    await page.getByTestId('identity-label').waitFor();
    const roomLabel = await page.locator('.demo-room-code').innerText();
    const nextRole = await page.getByTestId('identity-label').innerText();
    await page.reload();
    await page.getByTestId('identity-label').waitFor();
    assert.equal(await page.locator('.demo-room-code').innerText(), roomLabel);
    assert.equal(await page.getByTestId('identity-label').innerText(), nextRole);
    assert.equal(context.pages().length, 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '布局无横向溢出');
    assert.deepEqual(errors, []);
    console.log('✓ 无倒计时、自动结算、全员已读、七幕故事、真实状态回放、同页重开与刷新恢复');
  } else {
    await new Promise<void>(resolve => {
      finish = resolve;
      browser!.on('disconnected', () => { stopped = true; resolve(); });
      if (stopped) resolve();
    });
  }
} catch (error) {
  if (!stopped) { console.error(error); console.error(output); process.exitCode = 1; }
} finally {
  await browser?.close();
  for (const proc of processes) proc.kill('SIGTERM');
  await delay(200);
  for (const proc of processes) if (proc.exitCode === null) proc.kill('SIGKILL');
}
