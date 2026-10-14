<script setup lang="ts">
import type { RoundReport } from '@strange-realm/shared';
defineProps<{ report: RoundReport }>();
</script>
<template><section class="round-report" data-testid="round-report"><span class="eyebrow">第 {{ report.round }} 幕 · 所有选择已经发生</span><h2>这一轮发生了什么</h2><p>{{ report.summary }}</p><article v-for="(text,i) in report.consequences" :key="i" class="story-consequence">{{ text }}</article><div class="note-box"><strong>{{ report.endingPending ? '接下来揭晓真相' : '接下来要处理什么' }}</strong><p>{{ report.nextStep }}</p><p>没有倒计时。每人看完自己的结果后点已读，再一起继续。</p></div></section></template>
