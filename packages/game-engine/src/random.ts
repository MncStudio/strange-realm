import type { RandomSource } from './types';
/** Stable PRNG; explicit seed makes a round reproducible without wall-clock randomness. */
export class SeededRandom implements RandomSource {
  private state: number;
  constructor(seed: string) {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    this.state = hash >>> 0;
  }
  next(): number {
    let value = this.state += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  shuffle<T>(values: T[]): T[] {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i--) { const j = this.int(i + 1); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
    return copy;
  }
}
