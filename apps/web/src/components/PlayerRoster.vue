<script setup lang="ts">
import type { PublicPlayer } from '@strange-realm/shared';
defineProps<{ players: PublicPlayer[]; lobby?: boolean; reading?: boolean; myId?: string | null }>();
</script>
<template><div class="player-roster"><div v-for="(player,index) in players" :key="player.id" class="player-row" :class="{offline:!player.connected}"><span class="player-avatar">{{ String(index+1).padStart(2,'0') }}</span><div class="player-name"><strong>{{ player.nickname }}<span v-if="player.id === myId" class="you-tag">你</span></strong><small>{{ !player.connected ? '离线 · 可恢复原身份' : lobby ? (player.ready ? '已准备' : '等待准备') : reading ? (player.read ? '已读' : '正在看结果') : (player.submitted ? '已选择' : '正在考虑') }}</small></div><span class="roster-status">{{ (lobby ? player.ready : reading ? player.read : player.submitted) ? '✓' : '·' }}</span></div><p v-if="!players.length" class="muted small">还没有访客到达。</p></div></template>
