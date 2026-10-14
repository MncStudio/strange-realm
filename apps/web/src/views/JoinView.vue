<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useGameStore } from '../stores/game';
const game = useGameStore(); const route = useRoute(); const router = useRouter();
const code = ref(typeof route.query.code === 'string' ? route.query.code.toUpperCase() : ''); const nickname = ref(''); const pending = ref(false); const localError = ref('');
async function join() {
  if (pending.value) return; pending.value = true; localError.value = '';
  try { const result = await api<{roomId:string}>(`/api/rooms/${encodeURIComponent(code.value.trim().toUpperCase())}`); const id = await game.join(result.roomId, nickname.value.trim()); if(id) await router.push(`/room/${id}`); }
  catch(e) { localError.value = e instanceof Error ? e.message : '加入失败'; } finally { pending.value = false; }
}
</script>
<template>
  <main class="join-page page-width"><RouterLink class="back-link" to="/">← 返回平台</RouterLink><div class="join-layout"><section class="join-intro"><div class="eyebrow">VISITOR REGISTRATION</div><h1>登记你的名字。<br><span>秘密随后送达。</span></h1><p>请与主持电脑连接同一个局域网。<br>在公共屏幕上找到房间码，或直接扫描二维码。</p><div class="registration-art" aria-hidden="true"><span>入住登记</span><div></div><div></div><div></div><b>?</b></div></section><form class="join-form panel" @submit.prevent="join"><span class="eyebrow">CHECK IN / 入境登记</span><label class="field-label" for="room-code">房间码</label><input id="room-code" v-model="code" class="code-input" placeholder="例如 A7K2M9" required maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" /><label class="field-label" for="nickname">你的昵称</label><input id="nickname" v-model="nickname" placeholder="让朋友知道你是谁" required minlength="1" maxlength="16" autocomplete="nickname" /><p class="muted small">昵称会公开显示。身份和私人任务仅你可见。</p><p v-if="localError" class="inline-error" role="alert">{{ localError }}</p><button class="button primary full" :disabled="pending" type="submit">{{ pending ? '正在登记……' : '进入房间 →' }}</button><p class="join-footnote">一人一台设备 · 同一标签页可以刷新恢复</p></form></div></main>
</template>
