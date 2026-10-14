<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { PresentationCue } from '@strange-realm/shared';
import { usePresentationStore } from '../stores/presentation';
import { sound, enableSound, playSound } from '../presentation';
const props = defineProps<{ roomId: string; stageId: number; cues: PresentationCue[]; done: boolean }>();
const emit = defineEmits<{ complete: [] }>();
const presentation = usePresentationStore();
const text = ref(''); const blackout = ref(false); const playing = ref(false);
let generation = 0; let timer: ReturnType<typeof setTimeout> | undefined; let release: (() => void) | undefined;
function cancel() { generation++; if (timer) clearTimeout(timer); release?.(); release = undefined; playing.value = false; }
watch(() => [props.stageId, props.done] as const, async () => {
  cancel(); const version = generation; text.value = ''; blackout.value = false;
  if (props.done || !props.cues.length) return;
  playing.value = true;
  for (const cue of props.cues) {
    if (version !== generation) return;
    const key = `strange-realm:cue:${props.roomId}:${props.stageId}:${cue.id}`;
    let visited = false; try { visited = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch { /* Optional recovery cache. */ }
    if (visited) continue;
    text.value = cue.text || (cue.kind === 'sound' ? '广播信号正在接入……' : '');
    blackout.value = cue.kind === 'blackout' && presentation.animate;
    if (cue.kind === 'sound') playSound(cue.sound);
    await new Promise<void>(resolve => { release = resolve; timer = setTimeout(resolve, Math.min(cue.durationMs, 30000)); });
    release = undefined;
  }
  if (version === generation) { playing.value = false; blackout.value = false; emit('complete'); }
}, { immediate: true });
onBeforeUnmount(cancel);
</script>
<template>
  <Teleport to="body"><div v-if="blackout" class="screen-blackout" role="status"><p>{{ text }}</p><button class="text-button" @click="emit('complete')">跳过本段演出 →</button></div></Teleport>
  <section class="presentation-player" :class="{ 'presentation-blackout': blackout }" aria-live="polite" data-testid="presentation-player">
    <p v-if="playing" class="presentation-line">{{ text }}</p>
    <div class="sound-controls"><button class="text-button" @click="sound.enabled ? sound.enabled = false : enableSound()">{{ sound.enabled ? '声音开启 · 点此静音' : '点击启用现场声音' }}</button><label v-if="sound.enabled">音量 <input v-model.number="sound.volume" aria-label="现场音量" type="range" min="0" max="0.5" step="0.05" /></label><button v-if="!done" class="text-button" data-testid="skip-presentation" @click="emit('complete')">跳过本段演出 →</button></div>
    <p v-if="sound.error" class="muted small">{{ sound.error }}</p>
  </section>
</template>
