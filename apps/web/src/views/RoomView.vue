<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { readSavedSession, useGameStore } from '../stores/game';
import LobbyPanel from '../components/LobbyPanel.vue';
import HostScreen from '../components/HostScreen.vue';
import PlayerScreen from '../components/PlayerScreen.vue';
import EndingScreen from '../components/EndingScreen.vue';
const game = useGameStore(); const route = useRoute(); const router = useRouter(); const showLeave = ref(false); const missing = ref(false);
const correctRoom = computed(()=>game.publicState?.roomId===route.params.roomId);
onMounted(async()=>{ if(game.room?.roomId===route.params.roomId) return; const saved=readSavedSession(); if(saved?.roomId===route.params.roomId){ try { await game.reconnect(); }catch{ /* visible store error */ } } else { missing.value=true; } });
async function retry(){ try{ await game.reconnect(); }catch{ /* visible store error */ } }
async function leave(){ showLeave.value=false; await game.leave(); await router.push('/'); }
</script>
<template><main class="room-page" :class="{ 'host-room':game.isHost, 'mobile-room':!game.isHost }"><div v-if="missing" class="empty-panel room-empty"><div class="eyebrow">SESSION NOT FOUND</div><h1>请先登记身份</h1><p>此链接没有你的私人会话。使用公共屏幕上的房间码加入。</p><RouterLink to="/join" class="button primary">输入房间码 →</RouterLink></div><div v-else-if="!correctRoom || !game.session || game.status==='disconnected'" class="empty-panel room-empty" role="status"><div class="eyebrow">CONNECTING TO THE REALM</div><h1>{{ game.status==='disconnected' ? '连接暂时中断' : '正在进入诡境……' }}</h1><p>{{ game.status==='disconnected' ? '可以尝试恢复原有身份；如房间已经关闭，请重新加入。' : '恢复公共记录与属于你的秘密档案。' }}</p><div v-if="game.status==='disconnected'" class="hero-buttons"><button class="button primary" @click="retry">重试连接</button><button class="button secondary" @click="leave">返回平台</button></div></div><template v-else><div class="room-topline"><span>{{ game.isHost ? '公共主持屏幕' : '你的个人终端' }} <span class="muted">/ 房间 {{ game.publicState?.code }}</span></span><button class="text-button" @click="showLeave=true">离开房间 ↗</button></div><LobbyPanel v-if="game.publicState?.phase==='lobby'" /><EndingScreen v-else-if="game.publicState?.phase==='ended'" /><HostScreen v-else-if="game.isHost" /><PlayerScreen v-else /></template><div v-if="showLeave" class="modal-backdrop" @click.self="showLeave=false"><section class="confirm-modal panel" role="dialog" aria-modal="true" aria-labelledby="leave-title"><span class="eyebrow">LEAVE SESSION</span><h2 id="leave-title">确认离开房间？</h2><p>{{ game.isHost ? (game.publicState?.phase==='lobby' ? '你是房间主持人。等待大厅中主动离开会关闭房间，玩家需要重新加入新房间。' : '主动离开会清除主持凭证。公共演出与离线处理需要主持连接，这台电脑主动退出后无法恢复主持身份。') : '主动离开会清除这台设备的身份凭证。游戏开始后，你将无法用新身份重新加入这一局。' }}</p><div class="modal-actions"><button class="button secondary" @click="showLeave=false">留在房间</button><button class="button danger" @click="leave">确认离开</button></div></section></div></main></template>
