import { randomInt } from 'node:crypto';
import type { RealmRoom } from './room';

// This is a local single-process server. Entries contain rooms, never public engine state.
export const roomsByCode = new Map<string, RealmRoom>();

export function createRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (roomsByCode.has(code));
  return code;
}
