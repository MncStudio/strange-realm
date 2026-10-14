import { computed, ref, shallowRef, hasInjectionContext, inject, type InjectionKey } from 'vue';
import { defineStore, type Pinia } from 'pinia';
import { Client, Room } from 'colyseus.js';
import { MESSAGES, ROOM_TYPE, type ActionRequest, type PrivateSnapshot, type PublicSnapshot, type SessionInfo, type ServerError } from '@strange-realm/shared';

interface SavedSession { token: string; roomId: string; kind: 'host' | 'player' }
const STORAGE_KEY = 'strange-realm:session';
export function readSavedSession(storageKey = STORAGE_KEY): SavedSession | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    return saved?.token && saved?.roomId && ['host', 'player'].includes(saved.kind) ? saved : null;
  } catch { return null; }
}
function endpoint() {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  return configured ? configured.replace(/^http/, 'ws').replace(/\/$/, '') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;
}
const usePiniaGameStore = defineStore('game', () => {
  let storageKey = STORAGE_KEY;
  const room = shallowRef<Room | null>(null);
  const publicState = ref<PublicSnapshot | null>(null);
  const privateState = ref<PrivateSnapshot | null>(null);
  const session = ref<SessionInfo | null>(null);
  const status = ref<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('idle');
  const error = ref('');
  const actionPending = ref(false);
  const me = computed(() => publicState.value?.players.find(p => p.id === session.value?.playerId));
  const isHost = computed(() => session.value?.kind === 'host');
  const actionLocked = computed(() => actionPending.value || !!privateState.value?.submittedAction || !!me.value?.submitted);
  let intentionalLeave = false;
  let reconnectPromise: Promise<void> | null = null;
  let connectionGeneration = 0;
  function save() {
    if (!room.value || !session.value) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ token: room.value.reconnectionToken, roomId: room.value.roomId, kind: session.value.kind })); } catch { /* Storage may be unavailable in private browsing. */ }
  }
  function attach(next: Room, kind: 'host' | 'player') {
    room.value = next;
    intentionalLeave = false;
    session.value = { kind, playerId: session.value?.playerId || null };
    status.value = 'connected';
    actionPending.value = false;
    error.value = '';
    save();
    next.onMessage(MESSAGES.public, (snapshot: PublicSnapshot) => {
      if (room.value !== next) return;
      if (publicState.value?.round !== snapshot.round || snapshot.phase !== 'action') actionPending.value = false;
      publicState.value = snapshot;
      save();
    });
    next.onMessage(MESSAGES.private, (snapshot: PrivateSnapshot) => {
      if (room.value !== next) return;
      privateState.value = snapshot;
      if (snapshot.submittedAction) actionPending.value = false;
    });
    next.onMessage(MESSAGES.session, (info: SessionInfo) => { if (room.value === next) { session.value = info; save(); } });
    next.onMessage(MESSAGES.error, (data: ServerError) => { if (room.value === next) { error.value = data.message; actionPending.value = false; } });
    next.onError((_code, message) => { if (room.value === next) error.value = message || '连接出现异常。'; });
    next.onLeave(() => {
      if (intentionalLeave || room.value !== next) return;
      status.value = 'reconnecting';
      void reconnect().catch(() => { /* reconnect sets visible error. */ });
    });
    next.send(MESSAGES.sync);
  }
  async function create(scenarioId: string) {
    if (status.value === 'connecting') return;
    if (room.value || readSavedSession(storageKey)) await leave();
    status.value = 'connecting'; error.value = ''; privateState.value = null; publicState.value = null;
    try { const next = await new Client(endpoint()).create(ROOM_TYPE, { kind: 'host', scenarioId, hostKey: globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('') }); attach(next, 'host'); return next.roomId; }
    catch (cause) { status.value = 'idle'; error.value = message(cause); throw cause; }
  }
  async function join(roomId: string, nickname: string) {
    if (status.value === 'connecting') return;
    if (room.value || readSavedSession(storageKey)) await leave();
    status.value = 'connecting'; error.value = ''; privateState.value = null; publicState.value = null;
    try { const next = await new Client(endpoint()).joinById(roomId, { kind: 'player', nickname }); attach(next, 'player'); return next.roomId; }
    catch (cause) { status.value = 'idle'; error.value = message(cause); throw cause; }
  }
  async function reconnect() {
    if (reconnectPromise) return reconnectPromise;
    const saved = readSavedSession(storageKey);
    if (!saved) { status.value = 'disconnected'; error.value = '此标签页没有可恢复的身份，请使用房间码加入。'; return; }
    const generation = connectionGeneration;
    status.value = 'reconnecting'; error.value = '';
    reconnectPromise = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (intentionalLeave || generation !== connectionGeneration) return;
        try {
          const next = await new Client(endpoint()).reconnect(saved.token);
          if (intentionalLeave || generation !== connectionGeneration) { await next.leave(true); return; }
          attach(next, saved.kind); return;
        } catch (cause) { lastError = cause; }
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
      if (generation !== connectionGeneration) return;
      status.value = 'disconnected';
      error.value = `身份恢复失败：${message(lastError)}。房间可能已关闭或超过重连时限。`;
      throw lastError;
    })();
    try { await reconnectPromise; } finally { reconnectPromise = null; }
  }
  function send(type: 'ready' | 'start' | 'advance' | 'reset' | 'skipDisconnected' | 'presentationDone' | 'ackRead', payload?: boolean) {
    if (status.value !== 'connected' || !room.value) { error.value = '连接尚未恢复，请稍候。'; return; }
    error.value = '';
    const staged = ['advance', 'skipDisconnected', 'presentationDone', 'ackRead'].includes(type);
    room.value.send(MESSAGES[type], staged ? { stageId: publicState.value?.stageId } : payload);
  }
  function submit(request: ActionRequest) {
    if (actionLocked.value || status.value !== 'connected' || publicState.value?.phase !== 'action') return;
    actionPending.value = true; error.value = ''; room.value?.send(MESSAGES.action, request);
  }
  async function leave() {
    intentionalLeave = true; connectionGeneration++;
    const current = room.value; room.value = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* no persistent storage */ }
    publicState.value = null; privateState.value = null; session.value = null; actionPending.value = false; status.value = 'idle'; error.value = '';
    try { if (current?.connection.isOpen) await current.leave(true); } catch { /* Already disconnected. */ }
  }
  function setSessionNamespace(namespace: string) {
    if (room.value || status.value !== 'idle') throw new Error('只能在连接前设置会话命名空间。');
    storageKey = namespace;
  }
  return { room, publicState, privateState, session, status, error, actionPending, me, isHost, actionLocked, create, join, reconnect, send, submit, leave, setSessionNamespace };
});
export type GameStore = ReturnType<typeof usePiniaGameStore>;
export const gameStoreKey: InjectionKey<GameStore> = Symbol('ScopedGameStore');
export function useGameStore(pinia?: Pinia): GameStore {
  if (pinia) return usePiniaGameStore(pinia);
  return (hasInjectionContext() ? inject(gameStoreKey, null) : null) ?? usePiniaGameStore();
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : '服务器暂时不可用'; }
