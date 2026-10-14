import { ServerError } from '@colyseus/core';
import type { ActionRequest, StageRequest } from '@strange-realm/shared';
export function validateNickname(input: unknown): string {
  if (typeof input !== 'string') throw new ServerError(400, '请输入昵称。');
  const name = input.trim();
  if (!name || name.length > 16 || /[\u0000-\u001f\u007f]/u.test(name)) throw new ServerError(400, '昵称需为1～16个字符，且不能含控制字符。');
  return name;
}
function object(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('消息格式无效');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new Error('消息包含不允许的字段');
  return data;
}
function stage(data: Record<string, unknown>): number {
  if (!Number.isSafeInteger(data.stageId) || (data.stageId as number) < 1) throw new Error('阶段编号无效');
  return data.stageId as number;
}
export function validateStage(input: unknown): StageRequest { const data = object(input, ['stageId']); return { stageId: stage(data) }; }
export function validateAction(input: unknown): ActionRequest {
  const data = object(input, ['stageId', 'actionId', 'targetId']);
  if (typeof data.actionId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(data.actionId)) throw new Error('行动类型无效');
  if (data.targetId !== undefined && (typeof data.targetId !== 'string' || !data.targetId.length || data.targetId.length > 128)) throw new Error('目标格式无效');
  return { stageId: stage(data), actionId: data.actionId, ...(data.targetId !== undefined ? { targetId: data.targetId as string } : {}) };
}
