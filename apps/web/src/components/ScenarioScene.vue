<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { sceneAsset } from '../scenarios/art';
const props = withDefaults(defineProps<{
  scenarioId: string; eventId?: string; endingId?: string;
  variant?: 'cover' | 'stage' | 'card' | 'mobile'; signalLost?: boolean;
}>(), { variant: 'stage', signalLost: false });
const asset = computed(() => sceneAsset(props.scenarioId, props.eventId, props.endingId));
const failed = ref(false);
watch(() => asset.value?.src, () => { failed.value = false; });
</script>
<template>
  <figure v-if="asset && !failed" class="scenario-scene" :class="[`scene-${variant}`, `tone-${asset.tone}`, { 'scene-dark': signalLost }]" data-testid="scenario-scene">
    <Transition name="scene-crossfade" mode="out-in" type="transition">
      <img :key="asset.src" class="scene-photo" :src="asset.src" :alt="asset.alt" :loading="variant === 'mobile' ? 'lazy' : 'eager'" decoding="async" @error="failed = true" />
    </Transition>
    <div class="scene-vignette" aria-hidden="true"></div>
    <div class="scene-haze" aria-hidden="true"></div>
    <div class="scene-scan" aria-hidden="true"></div>
    <figcaption class="scene-caption"><span><i></i>现场影像</span><span>信号 {{ signalLost ? '微弱' : '接通' }}</span></figcaption>
  </figure>
</template>
