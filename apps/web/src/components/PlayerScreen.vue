<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useGameStore } from '../stores/game';
import RoundReport from './RoundReport.vue';
const game = useGameStore(); const state = computed(() => game.publicState!); const secret = computed(() => game.privateState);
const selected = ref(''); const target = ref(''); const screen = ref<HTMLElement>();
const option = computed(() => secret.value?.actions.find(action => action.id === selected.value));
const result = computed(() => secret.value?.results.filter(entry => entry.round === state.value.round).at(-1));
const targets = computed(() => state.value.players.filter(player => player.id !== game.session?.playerId));
const canSubmit = computed(() => state.value.phase === 'action' && game.status === 'connected' && !game.actionLocked && option.value && (option.value.targetMode === 'none' || target.value));
watch(() => state.value.stageId, async () => { selected.value = ''; target.value = ''; await nextTick(); const pane = screen.value?.closest('.demo-pane'); if (pane) pane.scrollTo({ top: 0 }); else window.scrollTo({ top: 0 }); });
function submit() { if (!canSubmit.value || !option.value) return; game.submit({ stageId: state.value.stageId, actionId: option.value.id, ...(option.value.targetMode === 'player' ? { targetId: target.value } : {}) }); }
</script>
<template>
  <section ref="screen" class="player-screen story-phone">
    <header class="player-game-header"><div><span class="eyebrow">仅本人可见 / {{ game.me?.nickname }}</span><h1 data-testid="identity-label">{{ secret?.identity.label || '正在连接' }}</h1></div><span>第 {{ state.round || '序' }} 幕</span></header>
    <p class="muted small" data-testid="identity-explanation">{{ secret?.identity.explanation }}</p>
    <template v-if="state.phase === 'introduction'"><article class="panel"><h2>你和朋友一起来到旅馆。</h2><p>没有提前分配的敌人，也没有一长串职业任务。请看大屏，先了解共同困境。</p><p class="note-box">手机收到的要求可以坦白，也可以拒绝。选择的后果由系统记录，不裁决你们说了什么。</p></article></template>
    <template v-else-if="state.phase === 'event'"><article class="panel"><span class="eyebrow">请看大屏</span><h2>{{ state.event?.title }}</h2><p>{{ state.event?.dilemma }}</p><p>公共演出后，主持会开放本轮讨论和选择。</p></article></template>
    <template v-else-if="state.phase === 'action'">
      <article class="panel mobile-event"><span class="eyebrow">现在要干什么</span><h2>{{ state.event?.dilemma }}</h2><p>{{ state.event?.hint }}</p></article>
      <article v-if="secret?.instruction" class="panel private-directive" data-testid="private-instruction"><span class="eyebrow">你收到了一条私人指令</span><h2>{{ secret.instruction.title }}</h2><p>{{ secret.instruction.text }}</p><p class="note-box">{{ secret.instruction.warning }}</p><small>可以坦白，也可以违抗。系统只根据本轮真实行动判定。</small></article>
      <article v-if="game.actionLocked" class="panel submitted-panel" data-testid="action-submitted"><h2>你的选择已提交</h2><p>还在等：{{ state.players.filter(player => !player.submitted).map(player => player.nickname).join('、') || '所有人已选完，正在结算' }}</p><p class="muted small">仍可以面对面交流。其他人看不到你的选择。</p></article>
      <form v-else @submit.prevent="submit"><div class="action-options"><button v-for="action in secret?.actions" :key="action.id" type="button" class="action-option" :class="{ selected: selected === action.id }" :data-testid="`action-${action.id}`" :aria-pressed="selected === action.id" @click="selected = action.id; target = ''"><div><strong>{{ action.label }}</strong><span>{{ selected === action.id ? '●' : '○' }}</span></div><p>{{ action.description }}</p></button></div><div class="panel submit-panel"><template v-if="option?.targetMode === 'player'"><label class="field-label" for="action-target">选择一名同伴</label><select id="action-target" v-model="target" required><option disabled value="">请选择</option><option v-for="player in targets" :key="player.id" :value="player.id">{{ player.nickname }}</option></select></template><button class="button primary full" type="submit" data-testid="submit-action" :disabled="!canSubmit">{{ option ? `确认 · ${option.label}` : '选择一个行动' }}</button><p class="muted tiny">每幕一个选择，提交后不能更改。没有倒计时。</p></div></form>
    </template>
    <template v-else-if="state.phase === 'resolution'"><article v-if="result" class="panel personal-round-result" data-testid="personal-round-result"><span class="eyebrow">你选择了 · {{ result.title }}</span><h2>对你发生了什么</h2><p>{{ result.text }}</p></article><RoundReport v-if="state.roundReport" class="panel" :report="state.roundReport" /><div class="read-dock panel"><button class="button primary full" data-testid="ack-read" :disabled="!state.presentationDone || !!game.me?.read || game.status !== 'connected'" @click="game.send('ackRead')">{{ !state.presentationDone ? '先看完公共后果' : game.me?.read ? '已读，等待其他人' : '我已读，准备继续 →' }}</button><p class="muted tiny">已读 {{ state.readCount }}/{{ state.players.length }}，全员已读自动继续。</p></div></template>
    <details v-if="secret && (secret.symptoms.length || secret.clues.length || secret.results.length)" class="panel known-information"><summary>我已经知道的情况</summary><section v-if="secret.symptoms.length"><h3>自己的征兆</h3><p v-for="symptom in secret.symptoms" :key="symptom">{{ symptom }}</p><small>征兆不等于已确认的感染。</small></section><section v-if="secret.clues.length"><h3>查证过的线索</h3><p v-for="clue in secret.clues" :key="clue">{{ clue }}</p></section><details><summary>以前的本人结果</summary><article v-for="(entry,i) in secret.results" :key="i" class="log-entry"><span>第{{ entry.round }}幕 · {{ entry.title }}</span><p>{{ entry.text }}</p></article></details></details>
  </section>
</template>
