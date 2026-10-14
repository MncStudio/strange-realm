import { randomUUID } from 'node:crypto';
import { Room, ServerError, type Client } from '@colyseus/core';
import { GameEngine } from '@strange-realm/game-engine';
import { getScenario } from '@strange-realm/scenarios';
import { MESSAGES, type SessionInfo } from '@strange-realm/shared';
import { createRoomCode, roomsByCode } from './registry';
import { validateAction, validateNickname, validateStage } from './validation';

interface CreateOptions { kind?: unknown; scenarioId?: unknown; hostKey?: unknown }
interface JoinOptions { kind?: unknown; nickname?: unknown; hostKey?: unknown }
interface Session extends SessionInfo { lastMessageAt: number; messageCount: number }

const RECONNECT_SECONDS = 180;
const MAX_MESSAGES_PER_SECOND = 12;
const MAX_IDLE_LOBBY_MS = 2 * 60 * 60 * 1000;
const MAX_IDLE_ENDED_MS = 30 * 60 * 1000;

export class RealmRoom extends Room {
  code = '';
  engine!: GameEngine;
  private hostSessionId: string | null = null;
  private hostKey = '';
  private sessions = new Map<string, Session>();
  private pendingReconnections = new Map<string, ReturnType<Room['allowReconnection']>>();
  private createdAt = Date.now();
  private lastFingerprint = '';
  private hostExpiryAt: number | null = null;
  private endingAt: number | null = null;
  private destroying = false;

  onCreate(options: CreateOptions): void {
    if (options.kind !== 'host' || typeof options.scenarioId !== 'string') {
      throw new ServerError(400, '请从创建房间页面选择剧本。');
    }
    if (typeof options.hostKey !== 'string' || !/^[A-Za-z0-9-]{32,128}$/.test(options.hostKey)) {
      throw new ServerError(400, '创建房间需要安全的房主凭证。');
    }
    this.hostKey = options.hostKey;
    let scenario;
    try { scenario = getScenario(options.scenarioId); }
    catch { throw new ServerError(400, '找不到所选剧本。'); }
    this.maxClients = scenario.summary.maxPlayers + 1; // Public screen occupies a separate seat.
    this.engine = new GameEngine(scenario, randomUUID());
    this.code = createRoomCode();
    this.autoDispose = true;
    roomsByCode.set(this.code, this);
    this.setMetadata({ code: this.code, scenarioId: scenario.summary.id });
    // Do not call setState(engine): raw state contains infection truth, instructions and submitted actions.
    this.onMessage(MESSAGES.sync, (client) => this.handle(client, () => this.sendSnapshots(client)));
    this.onMessage(MESSAGES.ready, (client, ready: unknown) => this.handle(client, () => {
      const session = this.requirePlayer(client);
      if (typeof ready !== 'boolean') throw new Error('准备状态必须是布尔值。');
      this.engine.setReady(session.playerId!, ready);
      this.publish();
    }));
    this.onMessage(MESSAGES.start, (client) => this.handle(client, () => {
      this.requireHost(client);
      this.engine.start(Date.now());
      this.publish();
    }));
    this.onMessage(MESSAGES.advance, (client, data: unknown) => this.handle(client, () => {
      this.requireHost(client); this.engine.advance(validateStage(data).stageId); this.publish();
    }));
    this.onMessage(MESSAGES.presentationDone, (client, data: unknown) => this.handle(client, () => {
      this.requireHost(client); this.engine.markPresentationDone(validateStage(data).stageId); this.publish();
    }));
    this.onMessage(MESSAGES.ackRead, (client, data: unknown) => this.handle(client, () => {
      const session = this.requirePlayer(client); this.engine.acknowledgeRead(session.playerId!, validateStage(data).stageId); this.publish();
    }));
    this.onMessage(MESSAGES.skipDisconnected, (client, data: unknown) => this.handle(client, () => {
      this.requireHost(client); this.engine.fillDisconnectedActions(validateStage(data).stageId); this.publish();
    }));
    this.onMessage(MESSAGES.reset, (client) => this.handle(client, () => {
      this.requireHost(client);
      if (this.engine.phase !== 'ended') throw new Error('游戏结束后才能开始新一局。');
      this.engine.reset(randomUUID());
      this.createdAt = Date.now();
      this.endingAt = null;
      // A disconnected player must rejoin before taking a seat in the next game.
      const players = this.engine.getPublicSnapshot(this.roomId, this.code, Date.now()).players;
      for (const player of players) {
        if (!this.clients.some((entry) => entry.sessionId === player.id)) {
          // Cancel old tickets before removing a seat: reconnecting must never reach
          // getPrivateSnapshot for a player removed from the new game's engine.
          this.pendingReconnections.get(player.id)?.reject(new Error('新一局已开始，请重新加入房间。'));
          this.pendingReconnections.delete(player.id);
          this.sessions.delete(player.id);
          this.engine.removePlayer(player.id);
        }
      }
      this.publish();
    }));
    this.onMessage(MESSAGES.action, (client, data: unknown) => this.handle(client, () => {
      const session = this.requirePlayer(client);
      this.engine.submitAction(session.playerId!, validateAction(data));
      this.publish();
    }));
    this.clock.setInterval(() => this.update(), 250);
  }

  onAuth(client: Client, options: JoinOptions): boolean {
    if (this.destroying) throw new ServerError(410, '这个房间已经关闭。');
    if (options.kind === 'host') {
      if (options.hostKey !== this.hostKey) throw new ServerError(403, '房主凭证无效。');
      if (this.hostSessionId !== null) throw new ServerError(403, '房主席位仅能使用原会话重连。');
      // Reserve during auth to prevent two simultaneous host joins.
      this.hostSessionId = client.sessionId;
      this.sessions.set(client.sessionId, { kind: 'host', playerId: null, lastMessageAt: 0, messageCount: 0 });
      return true;
    }
    if (options.kind !== 'player') throw new ServerError(400, '无效的加入类型。');
    if (this.engine.phase !== 'lobby') throw new ServerError(409, '游戏已经开始，请使用原会话重连。');
    const nickname = validateNickname(options.nickname);
    // Includes pending seat reservations; onAuth and onJoin may be separated in time.
    if ([...this.sessions.values()].filter((session) => session.kind === 'player').length >= this.maxClients - 1) {
      throw new ServerError(409, '房间玩家已满。');
    }
    this.engine.addPlayer(client.sessionId, nickname);
    this.sessions.set(client.sessionId, { kind: 'player', playerId: client.sessionId, lastMessageAt: 0, messageCount: 0 });
    return true;
  }

  onJoin(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) throw new ServerError(403, '会话尚未通过验证。');
    if (session.kind === 'player') this.engine.setConnected(client.sessionId, true);
    else this.hostExpiryAt = null;
    this.publish();
    this.sendSnapshots(client);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || this.destroying) return;
    if (session.kind === 'player') this.engine.setConnected(client.sessionId, false);
    else this.hostExpiryAt = Date.now() + RECONNECT_SECONDS * 1000;
    this.publish();
    if (!consented) {
      const ticket = this.allowReconnection(client, RECONNECT_SECONDS);
      this.pendingReconnections.set(client.sessionId, ticket);
      try {
        const reconnected = await ticket;
        if (this.destroying) return;
        if (session.kind === 'player') this.engine.setConnected(client.sessionId, true);
        else this.hostExpiryAt = null;
        session.lastMessageAt = 0;
        session.messageCount = 0;
        this.publish();
        this.sendSnapshots(reconnected);
        return;
      } catch {
        // Expired reservations retain the player's state until the game ends.
      } finally {
        if (this.pendingReconnections.get(client.sessionId) === ticket) this.pendingReconnections.delete(client.sessionId);
      }
    }
    if (this.destroying) return;
    if (session.kind === 'player') {
      if (this.engine.phase === 'lobby') this.engine.removePlayer(client.sessionId);
      this.sessions.delete(client.sessionId);
    } else {
      this.hostExpiryAt = Date.now();
    }
    this.publish();
    if (this.clients.length === 0) void this.closeRoom();
  }

  onDispose(): void {
    this.destroying = true;
    roomsByCode.delete(this.code);
    this.sessions.clear();
    this.pendingReconnections.clear();
  }

  summary() {
    const snapshot = this.engine.getPublicSnapshot(this.roomId, this.code, Date.now());
    return {
      roomId: this.roomId, code: this.code, scenario: snapshot.scenario,
      phase: snapshot.phase, playerCount: snapshot.players.length,
      maxPlayers: snapshot.scenario.maxPlayers,
    };
  }

  private update(): void {
    if (this.destroying) return;
    const now = Date.now();
    try {
      this.engine.tick(now);
      // Complete choices resolve; results advance only after presentation and every reader.
      this.publish();
      if (this.engine.phase === 'ended' && this.endingAt === null) this.endingAt = now;
      const hostExpiredInLobby = this.engine.phase === 'lobby' && this.hostExpiryAt !== null && now >= this.hostExpiryAt;
      const oldLobby = this.engine.phase === 'lobby' && now - this.createdAt >= MAX_IDLE_LOBBY_MS;
      const oldEnding = this.endingAt !== null && now - this.endingAt >= MAX_IDLE_ENDED_MS;
      if (hostExpiredInLobby || oldLobby || oldEnding) void this.closeRoom();
    } catch (error) {
      console.error(`房间 ${this.code} 自动推进失败:`, error);
    }
  }

  private publish(): void {
    if (this.destroying) return;
    const now = Date.now();
    const snapshot = this.engine.getPublicSnapshot(this.roomId, this.code, now);
    // Avoid broadcasting solely because serverNow changed every 250 ms.
    const fingerprint = JSON.stringify({ ...snapshot, serverNow: 0 });
    if (fingerprint !== this.lastFingerprint) {
      this.lastFingerprint = fingerprint;
      this.broadcast(MESSAGES.public, snapshot);
      for (const client of this.clients) this.sendPrivate(client);
    }
  }

  private sendSnapshots(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    client.send(MESSAGES.session, { kind: session.kind, playerId: session.playerId } satisfies SessionInfo);
    client.send(MESSAGES.public, this.engine.getPublicSnapshot(this.roomId, this.code, Date.now()));
    this.sendPrivate(client);
  }

  private sendPrivate(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (session?.kind === 'player' && session.playerId) {
      client.send(MESSAGES.private, this.engine.getPrivateSnapshot(session.playerId));
    }
  }

  private requirePlayer(client: Client): Session {
    const session = this.sessions.get(client.sessionId);
    if (session?.kind !== 'player') throw new Error('只有玩家可以执行这个操作。');
    return session;
  }

  private requireHost(client: Client): void {
    if (client.sessionId !== this.hostSessionId || this.sessions.get(client.sessionId)?.kind !== 'host') {
      throw new Error('只有房主可以执行这个操作。');
    }
  }

  private handle(client: Client, operation: () => void): void {
    if (this.destroying) return;
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const now = Date.now();
    if (now - session.lastMessageAt >= 1000) {
      session.lastMessageAt = now;
      session.messageCount = 0;
    }
    if (++session.messageCount > MAX_MESSAGES_PER_SECOND) {
      client.send(MESSAGES.error, { message: '操作太频繁，请稍后再试。', code: 'RATE_LIMIT' });
      return;
    }
    try { operation(); }
    catch (error) {
      client.send(MESSAGES.error, { message: error instanceof Error ? error.message : '操作失败。', code: 'INVALID_OPERATION' });
    }
  }

  private async closeRoom(): Promise<void> {
    if (this.destroying) return;
    this.destroying = true;
    roomsByCode.delete(this.code);
    await this.disconnect();
  }
}
