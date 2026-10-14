<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { createPinia } from 'pinia';
import { useRoute } from 'vue-router';
import type { ScenarioSummary } from '@strange-realm/shared';
import { api } from '../api';
import { useGameStore, readSavedSession } from '../stores/game';
import { cooperationPlan } from '../demo/cooperate';
import DemoPane from '../components/DemoPane.vue';
import '../demo/demo.css';

const route = useRoute();
const requested = Number(route.query.players ?? 4);
const count = Number.isInteger(requested) && requested >= 4 && requested <= 6 ? requested : 4;
const host = useGameStore(createPinia());
const players = Array.from({ length: count }, () => useGameStore(createPinia()));
const you = players[0]!;
host.setSessionNamespace('strange-realm:solo:host');
players.forEach((game, i) => game.setSessionNamespace(`strange-realm:solo:player:${i}`));
const stores = [host, ...players];
const loading = ref(true); const busy = ref(false); const error = ref('');
const mobilePane = ref<'host' | 'player'>('host');
const state = computed(() => host.publicState);
const phase = computed(() => state.value?.phase || 'lobby');
function ownSuggestion() {
  if (!you.privateState || !state.value || phase.value !== 'action' || you.actionLocked) return;
  return cooperationPlan(state.value, [{ id: you.session!.playerId!, secret: you.privateState, submitted: false }, ...players.slice(1).map(game => ({ id: game.session!.playerId!, secret: game.privateState!, submitted: game.actionLocked }))]).get(you.session!.playerId!);
}
const recommendation = computed(() => you.privateState?.actions.find(action => action.id === ownSuggestion()?.actionId)?.label || '');
const phaseLabel = computed(() => ({ lobby: '入场就绪', introduction: '普通访客开场', event: '公共事件演出', action: '讨论与秘密选择', resolution: '查看本轮结果', ended: '结局与身份揭晓' }[phase.value]));
const hint = computed(() => ({ lobby: '你和同伴均已准备。', introduction: '没有固定职业。先读大屏，点击开始故事。', event: '看大屏发生的事，再开放本轮讨论和选择。', action: '可以在手机手动选择，也可采用上方建议。同伴会完成自己的选择。', resolution: '先看公共后果和本人的私人结果。点已读后，同伴也会确认，自动进入下一幕。', ended: '可以回看秘密指令、真实感染和每个人的选择。' }[phase.value]));
let cancelled = false;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => unknown, label: string) {
  const start = Date.now();
  while (!predicate()) {
    if (cancelled) throw new Error('试玩已关闭');
    const failure = stores.find(game => game.error)?.error;
    if (failure) throw new Error(failure);
    if (Date.now() - start > 10000) throw new Error(`${label}超时，请重新连接。`);
    await delay(40);
  }
}
async function initialize() {
  loading.value = true; error.value = '';
  try {
    const savedHost = readSavedSession('strange-realm:solo:host');
    const canRestore = savedHost && players.every((_game, i) => readSavedSession(`strange-realm:solo:player:${i}`)?.roomId === savedHost.roomId);
    if (canRestore) {
      try { await host.reconnect(); await Promise.all(players.map(game => game.reconnect())); }
      catch { await Promise.allSettled(stores.map(game => game.leave())); }
    }
    if (!host.room || players.some(game => !game.room)) {
      const scenarios = await api<ScenarioSummary[]>('/api/scenarios');
      const scenario = scenarios[0];
      if (!scenario) throw new Error('服务端没有可试玩的剧本。');
      const roomId = await host.create(scenario.id);
      if (!roomId) throw new Error('房间未能建立。');
      await Promise.all(players.map((game, i) => game.join(roomId, i === 0 ? '你' : `自动同伴${i}`)));
    }
    await waitFor(() => host.publicState && players.every(game => game.publicState && game.privateState), '同步房间');
    if (host.publicState?.phase === 'lobby') await readyPlayers();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '连接失败'; }
  finally { loading.value = false; }
}
async function readyPlayers() {
  players.forEach(game => game.send('ready', true));
  await waitFor(() => host.publicState?.players.length === count && host.publicState.players.every(player => player.ready && player.connected), '同伴准备');
}
async function submitTogether(includeYou: boolean) {
  const current = host.publicState;
  if (!current || current.phase !== 'action') return;
  await waitFor(() => players.every(game => game.publicState?.round === current.round && game.publicState.phase === 'action' && (game.me?.submitted || game.privateState?.actions.length)), '行动同步');
  if (includeYou && !you.actionLocked) {
    const choice = ownSuggestion();
    if (!choice) throw new Error('请先在右侧选择一个可执行的行动。');
    you.submit(choice);
    await waitFor(() => !!you.privateState?.submittedAction, '你的选择确认');
  }
  const participants = players.map(game => ({ id: game.session!.playerId!, secret: game.privateState!, submitted: game.actionLocked }));
  const plan = cooperationPlan(current, participants);
  for (const game of players) {
    if (game === you) continue;
    const request = plan.get(game.session!.playerId!);
    if (request) game.submit(request);
  }
  await waitFor(() => host.publicState?.phase !== 'action' || host.publicState.round !== current.round, '统一结算');
}
async function acknowledgeTogether(includeYou: boolean) {
  const current = state.value;
  if (!current || current.phase !== 'resolution') return;
  if (!current.presentationDone) { host.send('presentationDone'); await waitFor(() => !!state.value?.presentationDone, '公共后果'); }
  for (const game of players.slice(1)) if (!game.me?.read) game.send('ackRead');
  if (includeYou && !you.me?.read) you.send('ackRead');
  await waitFor(() => state.value?.stageId !== current.stageId, '全员已读');
}
async function nextStep() {
  if (busy.value || loading.value) return;
  busy.value = true; error.value = '';
  try {
    if (phase.value === 'lobby') { host.send('start'); await waitFor(() => phase.value === 'introduction', '开场'); }
    else if (phase.value === 'introduction' || phase.value === 'event') {
      const stage = state.value!.stageId;
      if (!state.value?.presentationDone) { host.send('presentationDone'); await waitFor(() => !!state.value?.presentationDone, '演出就绪'); }
      host.send('advance'); await waitFor(() => state.value?.stageId !== stage, '进入故事');
    } else if (phase.value === 'action') await submitTogether(true);
    else if (phase.value === 'resolution') await acknowledgeTogether(true);
    else if (phase.value === 'ended') { host.send('reset'); await waitFor(() => phase.value === 'lobby', '返回大厅'); await readyPlayers(); }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败'; }
  finally { busy.value = false; }
}
watch(() => [phase.value, you.me?.submitted, you.me?.read, loading.value], async () => {
  if (loading.value || busy.value) return;
  const submit = phase.value === 'action' && you.me?.submitted;
  const read = phase.value === 'resolution' && you.me?.read;
  if (!submit && !read) return;
  busy.value = true;
  try { if (submit) await submitTogether(false); else await acknowledgeTogether(false); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '同伴操作失败'; }
  finally { busy.value = false; }
});
onMounted(() => { void initialize(); });
onBeforeUnmount(() => { cancelled = true; void Promise.allSettled(stores.map(game => game.leave())); });
</script>
<template>
  <main class="solo-demo" data-testid="solo-demo">
    <header class="demo-heading"><div><span class="eyebrow">SINGLE WINDOW / 单人走流程</span><h1>只用这一个窗口。</h1><p>你是一位普通访客，{{ count - 1 }}位同伴自动合作。</p></div><span class="demo-room-code" v-if="state">房间 {{ state.code }} · {{ count }}人</span></header>
    <section class="demo-controls panel">
      <div><strong data-testid="demo-phase">{{ phaseLabel }}</strong><span v-if="state && state.round">第 {{ state.round }} / {{ state.maxRounds }} 轮</span><p>{{ hint }}</p><p v-if="recommendation" class="demo-recommendation">本轮推荐：{{ recommendation }}</p></div>
      <div class="demo-buttons"><button class="button primary" data-testid="demo-next" :disabled="loading || busy || !!error" @click="nextStep">{{ phase === 'ended' ? '重新开始' : busy ? '正在结算…' : phase === 'resolution' ? '我已读，和同伴继续 →' : phase === 'action' ? '确认推荐选择 →' : '下一步 →' }}</button></div>
    </section>
    <div v-if="error" class="global-error" role="alert"><span>{{ error }}</span><button class="button secondary" :disabled="busy" @click="initialize">重新连接</button></div>
    <div v-if="loading" class="empty-panel" role="status">正在创建房间、加入同伴并准备……</div>
    <template v-else-if="state">
      <nav class="demo-mobile-switch"><button :class="{active:mobilePane==='host'}" @click="mobilePane='host'">公共画面</button><button :class="{active:mobilePane==='player'}" @click="mobilePane='player'">我的手机</button></nav>
      <div class="demo-layout"><section class="demo-pane demo-public" :class="{'demo-hidden-mobile':mobilePane!=='host'}" data-testid="demo-host"><div class="demo-pane-label">公共画面 <small>{{ phase === 'ended' ? '所有秘密已揭晓' : '只展示公共信息' }}</small></div><DemoPane :game="host" kind="host" /></section><section class="demo-pane demo-private" :class="{'demo-hidden-mobile':mobilePane!=='player'}" data-testid="demo-player"><div class="demo-pane-label">我的手机 <small>仅你的私人信息与结果</small></div><DemoPane :game="you" kind="player" /></section></div>
    </template>
  </main>
</template>
