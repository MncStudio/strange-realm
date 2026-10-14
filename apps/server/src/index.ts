import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { listScenarios } from '@strange-realm/scenarios';
import { ROOM_TYPE } from '@strange-realm/shared';
import { RealmRoom } from './room';
import { roomsByCode } from './registry';

const port = Number(process.env.PORT || 2567);
const webPort = Number(process.env.WEB_PORT || 5173);
const app = express();
app.use(cors());
app.use(express.json({ limit: '8kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'StrangeRealm', rooms: roomsByCode.size }));
app.get('/api/scenarios', (_req, res) => res.json(listScenarios()));
app.get('/api/network', (_req, res) => {
  const addresses = Object.values(networkInterfaces()).flat().filter((entry) => entry && entry.family === 'IPv4' && !entry.internal).map((entry) => entry!.address);
  res.json({ port: webPort, serverPort: port, urls: [...new Set(addresses)].map((ip) => `http://${ip}:${webPort}`) });
});
app.get('/api/rooms/:code', (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) { res.status(400).json({ message: '房间码为 6 位字母或数字。' }); return; }
  const room = roomsByCode.get(code);
  if (!room) { res.status(404).json({ message: '未找到这个房间，可能已经关闭。' }); return; }
  res.json(room.summary());
});

const httpServer = createServer(app);
const server = new Server({ transport: new WebSocketTransport({ server: httpServer, maxPayload: 8 * 1024 }) });
server.define(ROOM_TYPE, RealmRoom);
await server.listen(port, '0.0.0.0');
console.log(`诡境服务端已启动：http://0.0.0.0:${port}，WebSocket 与 HTTP 共用端口。`);

// Colyseus owns graceful shutdown; keep one hook for diagnostics rather than two competing exits.
server.onShutdown(() => console.log('诡境服务端已关闭。'));
