import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { loadStories, storySummary } from './stories.mjs';
import { GameError, createRoom, joinRoom, authenticate, act, snapshot } from './engine.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_FILE = fileURLToPath(new URL('./data/rooms.json', import.meta.url));
const loopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const credentialOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');

export function createGameServer({ dataFile = DEFAULT_FILE, storyDirectory } = {}) {
  const stories = loadStories(storyDirectory);
  const legacyStories = loadStories(storyDirectory, 'story.v1.json');
  const storyForRoom = r => r.flowVersion === 2 ? stories.get(r.storyId) : legacyStories.get(r.storyId);
  let rooms = new Map();
  if (dataFile && existsSync(dataFile)) {
    const saved = JSON.parse(readFileSync(dataFile, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.rooms)) throw new Error('存档格式不匹配，请先备份data/rooms.json。');
    for (const r of saved.rooms) {
      if (!stories.has(r.storyId)) throw new Error(`存档使用的故事${r.storyId}不存在，请放回故事或先备份存档。`);
      rooms.set(r.code, r);
    }
  }
  const streams = new Set();
  const limiter = new Map();
  const save = () => {
    if (!dataFile) return;
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(`${dataFile}.tmp`, JSON.stringify({ version: 1, rooms: [...rooms.values()] }), { mode: 0o600 });
    renameSync(`${dataFile}.tmp`, dataFile);
  };
  const transaction = (fn) => {
    const before = structuredClone([...rooms.entries()]);
    try { const result = fn(); save(); return result; }
    catch (error) { rooms = new Map(before); throw error; }
  };
  const online = (code, token) => [...streams].some(s => s.code === code && s.token === token);
  const getRoom = (code) => { const room = rooms.get(code); if (!room) throw new GameError('房间不存在或已过期，请回到首页重新加入。', 404); return room; };
  const view = (code, token) => { const r = getRoom(code); return snapshot(r, storyForRoom(r), token, t => online(code, t)); };
  const send = (connection) => {
    try { connection.res.write(`event: state\ndata: ${JSON.stringify(view(connection.code, connection.token))}\n\n`); }
    catch { streams.delete(connection); connection.res.end(); }
  };
  const broadcast = (code) => { for (const s of streams) if (s.code === code) send(s); };
  const info = () => {
    const port = server.address()?.port || 3210;
    const entries = Object.entries(networkInterfaces()).sort(([a], [b]) => Number(!/^(en|eth|wlan)/.test(a)) - Number(!/^(en|eth|wlan)/.test(b)));
    const addresses = [...new Set(entries.flatMap(([, items]) => items.filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && !/^198\.(18|19)\./.test(a.address)).map(a => a.address)))];
    return { localUrl: `http://localhost:${port}`, urls: addresses.map(ip => `http://${ip}:${port}`), stories: [...stories.values()].map(storySummary) };
  };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const bodyOf = (req) => new Promise((resolve, reject) => {
    let text = '', size = 0, exceeded = false;
    req.on('data', chunk => { size += chunk.length; if (size > 16384) { if (!exceeded) reject(new GameError('请求内容过长。', 413)); exceeded = true; } else text += chunk; });
    req.on('end', () => { if (exceeded) return; try { const obj = JSON.parse(text || '{}'); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(); resolve(obj); } catch { reject(new GameError('请发送有效JSON对象。')); } });
    req.on('error', reject);
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!(url.hostname === 'localhost' || isIP(url.hostname.replace(/^\[|\]$/g, '')))) throw new GameError('请使用电脑显示的局域网IP或localhost访问。', 403);
      if (req.headers.origin && req.headers.origin !== url.origin) throw new GameError('不允许其他网站操作本机游戏。', 403);
      if (req.method === 'POST') {
        const key = req.socket.remoteAddress;
        const time = Date.now(); const bucket = limiter.get(key) || { time, count: 0 };
        if (time - bucket.time > 60000) { bucket.time = time; bucket.count = 0; }
        bucket.count++; limiter.set(key, bucket);
        if (bucket.count > 360) throw new GameError('操作过于频繁，请稍后再试。', 429);
      }
      if (req.method === 'GET' && ['/','/index.html'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(readFileSync(`${root}/web/index.html`)); return;
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && url.pathname === '/api/info') { json(res, 200, info()); return; }
      if (req.method === 'POST' && ['/api/rooms', '/api/demo'].includes(url.pathname)) {
        const body = await bodyOf(req);
        const story = stories.get(body.storyId); if (!story) throw new GameError('请选择存在的故事。');
        const demo = url.pathname === '/api/demo';
        if (demo && !loopback(req.socket.remoteAddress)) throw new GameError('单人试玩请在服务器电脑上用localhost打开。', 403);
        if (rooms.size >= 100) throw new GameError('房间数量已达上限，请清理旧房间后再试。', 409);
        let room; do { room = createRoom(story.id, { demo, playMode: story.playMode || 'classic', flowVersion: story.flowVersion || 1 }); } while (rooms.has(room.code));
        const demoPlayers = [];
        transaction(() => {
          rooms.set(room.code, room);
          if (demo) for (let i = 0; i < story.players; i++) { const p = joinRoom(room, story, `试玩${i + 1}`, { internalDemo: true }); demoPlayers.push({ id: p.id, token: p.token, nickname: p.nickname }); }
        });
        json(res, 201, { code: room.code, token: room.hostToken, ...(demo ? { players: demoPlayers } : {}) }); return;
      }
      const route = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(preview|join|state|events|action|qr)$/);
      if (!route) throw new GameError('没有这个地址。', 404);
      const [, code, endpoint] = route; const room = getRoom(code); const story = stories.get(room.storyId);
      if (req.method === 'GET' && endpoint === 'preview') { json(res, 200, { code, story: storySummary(story), count: room.players.length, stage: room.stage, demo: room.demo }); return; }
      if (req.method === 'GET' && endpoint === 'qr') {
        const allowed = [...info().urls, info().localUrl, `http://127.0.0.1:${server.address().port}`];
        const base = url.searchParams.get('base') || info().urls[0] || info().localUrl;
        if (!allowed.includes(base)) throw new GameError('请从电脑的可用地址中选择。');
        const svg = await QRCode.toString(`${base}/?room=${code}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', width: 240 });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(svg); return;
      }
      if (req.method === 'POST' && endpoint === 'join') {
        const body = await bodyOf(req);
        const player = transaction(() => joinRoom(getRoom(code), story, body.nickname));
        json(res, 201, { code, token: player.token, id: player.id }); broadcast(code); return;
      }
      const credential = endpoint === 'events' ? url.searchParams.get('token') : credentialOf(req);
      authenticate(room, credential);
      if (req.method === 'GET' && endpoint === 'state') { json(res, 200, view(code, credential)); return; }
      if (req.method === 'GET' && endpoint === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1500\n\n');
        const connection = { code, token: credential, res };
        streams.add(connection); broadcast(code);
        res.on('close', () => { streams.delete(connection); broadcast(code); }); return;
      }
      if (req.method === 'POST' && endpoint === 'action') {
        const data = await bodyOf(req);
        transaction(() => act(getRoom(code), data.kind === 'reset' ? story : storyForRoom(getRoom(code)), credential, data));
        json(res, 200, view(code, credential)); broadcast(code); return;
      }
      throw new GameError('请求方式不支持。', 405);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json(res, error instanceof GameError ? error.status : 500, { error: error instanceof GameError ? error.message : '服务器暂时无法完成操作，请稍后重试。' });
      if (!(error instanceof GameError)) console.error(error);
    }
  });
  const heartbeat = setInterval(() => { for (const s of streams) s.res.write(': keepalive\n\n'); }, 15000);
  const cleanup = setInterval(() => {
    let changed = false;
    for (const [code, r] of rooms) if (Date.now() - r.updatedAt > 48 * 60 * 60 * 1000 && ![...streams].some(s => s.code === code)) { rooms.delete(code); changed = true; }
    for (const [ip, entry] of limiter) if (Date.now() - entry.time > 120000) limiter.delete(ip);
    if (changed) { try { save(); } catch (error) { console.error('旧房间清理未能保存', error.message); } }
  }, 60000);
  heartbeat.unref(); cleanup.unref();
  server.on('close', () => { clearInterval(heartbeat); clearInterval(cleanup); });
  const close = () => new Promise(resolve => { for (const s of streams) s.res.end(); server.close(resolve); server.closeAllConnections(); });
  return { server, info, close, getRoom, stories };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const app = createGameServer(); const port = Number(process.env.PORT || 3210);
    app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口${port}已被占用。可以改用 PORT=3211 npm run dev。` : error.message); process.exitCode = 1; app.server.close(); });
    app.server.listen(port, '0.0.0.0', () => {
      const i = app.info(); console.log(`\n诡境 · StrangeRealm\n电脑打开：${i.localUrl}\n手机连接同一Wi-Fi后访问：\n${i.urls.join('\n') || '未找到局域网地址，请检查Wi-Fi。'}\n\n按 Ctrl+C 停止。进度已保存在data目录。\n`);
      if (process.argv.includes('--open')) { const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'; const child = spawn(command, [i.localUrl], { stdio: 'ignore' }); child.on('error', () => {}); child.unref(); }
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().then(() => process.exit(0)); });
  } catch (error) { console.error('启动失败：', error.message); process.exitCode = 1; }
}
