<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ScenarioSummary } from '@strange-realm/shared';
import { api } from '../api';
import { readSavedSession, useGameStore } from '../stores/game';
import ScenarioScene from '../components/ScenarioScene.vue';
const game = useGameStore();
const saved = readSavedSession();
const scenario = ref<ScenarioSummary | null>(null);
onMounted(async () => { try { scenario.value = (await api<ScenarioSummary[]>('/api/scenarios'))[0] || null; } catch { /* The creation page offers connection recovery. */ } });
</script>
<template>
  <main class="home-page page-width">
    <div class="hero-grid">
      <section class="hero-copy">
        <div class="eyebrow"><span class="tiny-square"></span>异常事件档案 / VOL. 001</div>
        <h1>每个人都有秘密。<br><span>但你们必须一起离开。</span></h1>
        <p class="hero-description">一台电脑，一桌朋友。走进规则怪谈，在合作与隐瞒之间，决定谁能活着走到结局。</p>
        <div class="hero-buttons"><RouterLink to="/create" class="button primary">创建游戏 <span>↗</span></RouterLink><RouterLink to="/join" class="button secondary">加入房间 <span>→</span></RouterLink></div>
        <RouterLink v-if="game.room || saved" :to="`/room/${game.room?.roomId || saved?.roomId}`" class="resume-link">↳ 返回上次的房间</RouterLink>
        <div class="hero-facts"><div><strong>4—6</strong><span>现实中的朋友</span></div><div><strong>不限时</strong><span>读完后再继续</span></div><div><strong>01</strong><span>公共主持屏幕</span></div></div>
      </section>
      <section class="hotel-file" aria-label="旅馆异常档案插图">
        <div class="file-top"><span>CASE FILE / 007</span><span class="file-stamp">调查中</span></div>
        <ScenarioScene v-if="scenario" :scenario-id="scenario.id" variant="cover" />
        <div class="file-bottom"><div><span class="eyebrow">当前收录剧本</span><h2>{{ scenario?.title || '异常档案' }}</h2><p>{{ scenario?.subtitle || '等待接入，等待下一次调查。' }}</p></div><span class="file-number">07</span></div>
      </section>
    </div>
    <section class="how-to"><div class="section-label">入境须知 <span>BEFORE YOU ENTER</span></div><div class="steps-grid"><article><span class="step-index">01 / 集合</span><h3>让电脑成为公共屏幕</h3><p>主持人创建房间，所有设备接入同一个 Wi-Fi。</p></article><article><span class="step-index">02 / 隐瞒</span><h3>手机收到私人指令</h3><p>扫码加入，从普通访客开始，留意征兆与私人消息。</p></article><article><span class="step-index">03 / 抉择</span><h3>讨论，然后独立行动</h3><p>可以合作，也可以说谎。行动统一结算，后果不会说谎。</p></article></div></section>
  </main>
</template>
