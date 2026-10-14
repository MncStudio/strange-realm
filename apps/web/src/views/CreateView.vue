<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ScenarioSummary } from '@strange-realm/shared';
import { api } from '../api';
import { useGameStore } from '../stores/game';
import ScenarioScene from '../components/ScenarioScene.vue';
const game = useGameStore(); const router = useRouter();
const scenarios = ref<ScenarioSummary[]>([]); const selected = ref(''); const loading = ref(true); const loadError = ref('');
async function load() { loading.value = true; loadError.value = ''; try { scenarios.value = await api<ScenarioSummary[]>('/api/scenarios'); selected.value = scenarios.value[0]?.id || ''; } catch (e) { loadError.value = e instanceof Error ? e.message : '读取剧本失败'; } finally { loading.value = false; } }
onMounted(load);
async function create() { try { const id = await game.create(selected.value); if (id) await router.push(`/room/${id}`); } catch { /* The store displays errors. */ } }
</script>
<template>
  <main class="page-width setup-page"><RouterLink class="back-link" to="/">← 返回平台</RouterLink><div class="page-heading"><div class="eyebrow">NEW INVESTIGATION</div><h1>开启一次调查</h1><p>选择异常档案。你将作为主持人，管理公共屏幕与游戏节奏。</p></div>
    <div v-if="loading" class="empty-panel" role="status">正在读取异常档案……</div><div v-else-if="loadError" class="empty-panel"><p>{{ loadError }}</p><button class="button secondary" @click="load">重新读取</button></div>
    <form v-else class="create-layout" @submit.prevent="create">
      <div class="scenario-list"><label v-for="(scenario,index) in scenarios" :key="scenario.id" class="scenario-card" :class="{ selected: selected === scenario.id }"><input type="radio" v-model="selected" :value="scenario.id" name="scenario" /><div class="scenario-card-top"><span class="eyebrow">档案 {{ String(index + 1).padStart(3,'0') }}</span><span class="scenario-selection">{{ selected === scenario.id ? '已选择 ✓' : '选择档案' }}</span></div><ScenarioScene :scenario-id="scenario.id" variant="card" /><div class="scenario-emblem" aria-hidden="true">{{ String(index + 1).padStart(2,'0') }}</div><h2>{{ scenario.title }}</h2><p class="subtitle">{{ scenario.subtitle }}</p><p>{{ scenario.synopsis }}</p><div class="tag-row"><span>{{ scenario.minPlayers }}—{{ scenario.maxPlayers }} 人</span><span>{{ scenario.estimatedMinutes }}</span><span>规则怪谈</span></div></label><div v-if="!scenarios.length" class="empty-panel">暂无可用剧本，请检查服务端剧本注册。</div></div>
      <aside class="setup-settings panel"><span class="eyebrow">SESSION SETTINGS</span><h2>房间设置</h2><p class="muted small">不限讨论时间。全员选择后统一结算，读完结果再由主持人继续。</p><div class="note-box"><strong>主持电脑也需要保持在线</strong><p>玩家通过自己的手机加入。主持人只看见公开信息，不占用玩家名额。</p></div><button class="button primary full" type="submit" :disabled="!selected || game.status === 'connecting'">{{ game.status === 'connecting' ? '正在建立房间……' : '创建房间 →' }}</button></aside>
    </form>
  </main>
</template>
