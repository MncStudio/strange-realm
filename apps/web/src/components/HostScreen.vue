<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useGameStore } from '../stores/game';
import ScenarioScene from './ScenarioScene.vue';
import PresentationPlayer from './PresentationPlayer.vue';
import RoundReport from './RoundReport.vue';
import PlayerRoster from './PlayerRoster.vue';
const game = useGameStore(); const state = computed(() => game.publicState!); const screen = ref<HTMLElement>();
const waiting = computed(() => state.value.players.filter(player => state.value.phase === 'resolution' ? !player.read : !player.submitted));
watch(() => state.value.stageId, async () => { await nextTick(); const pane = screen.value?.closest('.demo-pane'); if (pane) pane.scrollTo({ top: 0 }); else window.scrollTo({ top: 0 }); });
</script>
<template>
  <section ref="screen" class="host-screen" :data-stage-id="state.stageId" :data-phase="state.phase">
    <header class="host-toolbar"><div><span class="eyebrow">PUBLIC DISPLAY / 共同经历</span><h1>{{ state.scenario.title }}</h1></div><div class="round-indicator"><span>{{ state.phase === 'resolution' ? '看完后各自点已读' : state.phase === 'action' ? '面对面讨论 · 秘密选择' : '请看公共屏幕' }}</span><strong>{{ state.round || '开场' }} <small v-if="state.round">/ {{ state.maxRounds }} 幕</small></strong></div></header>
    <div class="host-grid"><div class="host-story"><article class="story-panel panel">
      <ScenarioScene :scenario-id="state.scenario.id" :event-id="state.event?.id" />
      <template v-if="state.phase === 'introduction'"><span class="eyebrow">所有人都是普通访客</span><h2>登记簿上，多了一个人。</h2><p class="narrative">{{ state.intro }}</p></template>
      <RoundReport v-else-if="state.phase === 'resolution' && state.roundReport" :report="state.roundReport" />
      <template v-else><span class="eyebrow">发生了什么</span><h2>{{ state.event?.title }}</h2><p class="narrative">{{ state.event?.narrative }}</p><div class="event-hint"><span>现在要处理什么</span><strong>{{ state.event?.dilemma }}</strong><p>{{ state.event?.hint }}</p></div></template>
      <PresentationPlayer v-if="['introduction', 'event', 'resolution'].includes(state.phase)" :key="state.stageId" :room-id="state.roomId" :stage-id="state.stageId" :cues="state.cues" :done="state.presentationDone" @complete="game.send('presentationDone')" />
      <div v-if="state.phase === 'introduction' || state.phase === 'event'" class="story-action"><button class="button primary" data-testid="begin-action" :disabled="!state.presentationDone || game.status !== 'connected'" @click="game.send('advance')">{{ state.phase === 'introduction' ? '大家明白了，开始故事 →' : '开始讨论与选择 →' }}</button></div>
      <div v-if="state.phase === 'action' || state.phase === 'resolution'" class="submission-status"><h3>{{ state.phase === 'action' ? `已选择 ${state.submittedCount}/${state.players.length}` : `已读 ${state.readCount}/${state.players.length}` }}</h3><p>等待：{{ waiting.map(player => player.nickname + (player.connected ? '' : '（离线）')).join('、') || '所有人已完成' }}</p><p class="muted small">{{ state.phase === 'action' ? '全员提交后自动结算，具体选择保持秘密。' : '每人读完手机结果后点已读，全员已读自动继续。' }}</p><button v-if="waiting.some(player => !player.connected)" class="button secondary" :disabled="state.phase === 'resolution' && !state.presentationDone" @click="game.send('skipDisconnected')">{{ state.phase === 'action' ? '替未提交的离线玩家选择默认行为' : '确认离线玩家已读' }}</button></div>
    </article><section class="panel shared-goal"><span class="eyebrow">共同目标</span><p>{{ state.goal }}</p><ul v-if="state.facts.length"><li v-for="fact in state.facts" :key="fact">{{ fact }}</li></ul></section><details class="panel public-rules"><summary>需要记住的约定</summary><p v-for="rule in state.publicRules" :key="rule">{{ rule }}</p></details></div><aside class="host-side"><section class="panel"><h2>一起在场的人</h2><PlayerRoster :players="state.players" :reading="state.phase === 'resolution'" /></section><section class="panel public-log"><h2>刚才发生过</h2><article v-for="(entry, index) in [...state.log].reverse().slice(0,4)" :key="index" class="log-entry"><span>第{{ entry.round }}幕 · {{ entry.title }}</span><p>{{ entry.text }}</p></article></section></aside></div>
  </section>
</template>
