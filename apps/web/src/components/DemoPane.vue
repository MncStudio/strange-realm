<script setup lang="ts">
import { provide } from 'vue';
import { gameStoreKey, type GameStore } from '../stores/game';
import HostScreen from './HostScreen.vue';
import PlayerScreen from './PlayerScreen.vue';
import EndingScreen from './EndingScreen.vue';
const props = defineProps<{ game: GameStore; kind: 'host' | 'player' }>(); provide(gameStoreKey, props.game);
</script>
<template><EndingScreen v-if="kind === 'host' && game.publicState?.phase === 'ended'" /><article v-else-if="kind === 'player' && game.publicState?.phase === 'ended' && game.privateState?.outcome" class="panel"><span class="eyebrow">你的结局</span><h2>{{ game.privateState.outcome.identity }}</h2><p>{{ game.privateState.outcome.reason }}</p><p v-for="choice in game.privateState.outcome.choices" :key="choice">{{ choice }}</p><p class="note-box">左侧公共屏幕已揭晓全部故事与真实因果。</p></article><HostScreen v-else-if="kind === 'host' && game.publicState && game.publicState.phase !== 'lobby'" /><PlayerScreen v-else-if="kind === 'player' && game.privateState && game.publicState?.phase !== 'lobby'" /><div v-else class="empty-panel"><h2>所有人已就绪</h2><p>点击上方开始，和朋友一起进入旅馆。</p></div></template>
