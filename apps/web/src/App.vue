<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useGameStore } from './stores/game';
import { usePresentationStore } from './stores/presentation';
const game = useGameStore();
const presentation = usePresentationStore();
const testMode = import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === '1';
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
function syncMotion() { presentation.reducedBySystem = motionQuery.matches; }
onMounted(() => { motionQuery.addEventListener('change', syncMotion); });
onUnmounted(() => { motionQuery.removeEventListener('change', syncMotion); });
</script>
<template>
  <div class="app-shell" :class="{ 'host-display': game.isHost && game.publicState?.phase !== 'lobby', 'motion-off': !presentation.animate }">
    <header class="topbar">
      <RouterLink to="/" class="brand" aria-label="诡境首页"><span class="brand-symbol">诡</span><span>诡境<small>STRANGE REALM</small></span></RouterLink>
      <div class="topbar-tools"><button class="motion-toggle" data-testid="motion-toggle" :aria-pressed="presentation.motionEnabled" @click="presentation.toggle">{{ presentation.motionEnabled ? '动效开启' : '动效关闭' }}</button><span class="system-status"><i :class="{ live: game.status === 'connected' }"></i>{{ game.status === 'connected' ? '档案连接已建立' : game.status === 'reconnecting' ? '正在恢复连接' : '局域网多人叙事实验' }}</span></div>
    </header>
    <div v-if="testMode" class="test-mode-banner">本地试玩 · 选完先读结果，再确认继续</div>
    <div v-if="game.error" class="global-error" role="alert"><span>{{ game.error }}</span><button class="icon-button" @click="game.error = ''" aria-label="关闭提示">×</button></div>
    <div v-if="game.status === 'reconnecting'" class="connection-banner" role="status">信号中断，正在恢复你的身份与游戏进度……</div>
    <RouterView />
    <footer class="site-footer"><span>STRANGE REALM / 异常事件档案</span><span>面对面交流 · 各自保守秘密</span></footer>
  </div>
</template>
