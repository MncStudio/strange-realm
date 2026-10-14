<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../stores/game';
import ScenarioScene from './ScenarioScene.vue';
const game = useGameStore(); const state = computed(() => game.publicState!); const ending = computed(() => state.value.ending);
function saveReplay() {
  const snapshot = state.value;
  if (snapshot.phase !== 'ended' || !snapshot.ending) return;
  // Export only the already revealed story; never serialize a Room, token or private store.
  const record = { format: 'strange-realm-story-v1', scenario: snapshot.scenario, roomCode: snapshot.code, ending: snapshot.ending, replay: snapshot.replay };
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `strange-realm-story-${snapshot.code}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
</script>
<template><section v-if="ending" class="ending-screen"><header class="ending-heading"><ScenarioScene :scenario-id="state.scenario.id" :ending-id="ending.id" variant="card" /><span class="eyebrow">故事结束 · 现在揭晓真相</span><h1>{{ ending.title }}</h1><p>{{ ending.narrative }}</p></header><div class="outcome-grid"><article v-for="outcome in ending.outcomes" :key="outcome.playerId" class="panel"><span class="eyebrow">{{ outcome.nickname }} · {{ outcome.escaped ? '通过边界' : '留在旅馆' }}</span><h2>{{ outcome.identity }}</h2><p>{{ outcome.reason }}</p><p v-for="choice in outcome.choices" :key="choice" class="muted small">{{ choice }}</p></article></div><section class="replay-section"><h2>为什么会变成这样</h2><p class="muted">此前没有公开的选择、指令与感染原因，现在逐幕揭晓。</p><details v-for="entry in state.replay" :key="entry.round" class="panel replay-round"><summary>第 {{ entry.round }} 幕 · {{ entry.event }}</summary><article v-for="(action,i) in entry.actions" :key="i" class="log-entry"><strong>{{ action.nickname }} · {{ action.action }}</strong><p>{{ action.result }}</p></article><div class="note-box"><p v-for="(cause,i) in entry.causes" :key="i"><strong>{{ cause.nickname || '旅馆' }} · {{ cause.title }}</strong>：{{ cause.detail }}</p></div></details></section><div class="ending-controls"><button v-if="game.isHost" class="button secondary" data-testid="save-replay" @click="saveReplay">保存本局故事回放</button><button v-if="game.isHost" class="button primary" @click="game.send('reset')">返回大厅，重新开始 →</button><p v-else class="muted">等待主持人重新开局。下次收到的指令和故事变化可能不同。</p></div></section></template>
