import { reactive } from 'vue';
import type { PresentationCue } from '@strange-realm/shared';
export const sound = reactive({ enabled: false, volume: 0.3, error: '' });
let context: AudioContext | undefined;
export async function enableSound(): Promise<void> {
  try { context ??= new AudioContext(); await context.resume(); sound.enabled = context.state === 'running'; sound.error = sound.enabled ? '' : '浏览器未开放声音；字幕仍可正常继续。'; }
  catch { sound.enabled = false; sound.error = '此设备无法播放声音，使用字幕继续。'; }
}
export function playSound(kind: PresentationCue['sound']): void {
  if (!sound.enabled || !context || context.state !== 'running') return;
  const patterns: Record<string, number[]> = { knock: [75, 65, 75], hum: [52], chime: [330, 440], heartbeat: [65, 52] };
  for (const [index, hz] of (patterns[kind || 'hum'] || [52]).entries()) {
    const at = context.currentTime + index * 0.18; const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = kind === 'chime' ? 'sine' : 'triangle'; oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(Math.min(0.5, Math.max(0, sound.volume)), at + 0.015); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.18);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
