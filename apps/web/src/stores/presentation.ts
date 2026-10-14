import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
export const usePresentationStore = defineStore('presentation', () => {
  const reducedBySystem = ref(matchMedia('(prefers-reduced-motion: reduce)').matches);
  let initial = true;
  try { initial = localStorage.getItem('strange-realm:motion') !== 'off'; } catch { /* Optional preference. */ }
  const motionEnabled = ref(initial);
  const animate = computed(() => motionEnabled.value && !reducedBySystem.value);
  function toggle() {
    motionEnabled.value = !motionEnabled.value;
    try { localStorage.setItem('strange-realm:motion', motionEnabled.value ? 'on' : 'off'); } catch { /* Optional preference. */ }
  }
  return { reducedBySystem, motionEnabled, animate, toggle };
});
