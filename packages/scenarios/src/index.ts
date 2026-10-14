import type { ScenarioDefinition } from '@strange-realm/game-engine';
import type { ScenarioSummary } from '@strange-realm/shared';
import data from '../seventh-visitor/scenario.json';
import { initialize, createInstructions, getActions, resolveRound, evaluateEnding, evaluatePlayer, describeSituation } from '../seventh-visitor/rules';
export type { ScenarioDefinition } from '@strange-realm/game-engine';
export const seventhVisitor: ScenarioDefinition = { ...data, initialize, createInstructions, getActions, resolveRound, evaluateEnding, evaluatePlayer, describeSituation,
  resultCues: (_ctx, consequences) => [{ id: 'aftermath-sound', kind: 'sound', sound: 'heartbeat', durationMs: 400 }, { id: 'aftermath', kind: 'text', text: consequences.join('\n'), durationMs: 1600 }] } as ScenarioDefinition;
export function validateScenario(scenario: ScenarioDefinition): void {
  const seen = new Set<string>();
  if (!Number.isInteger(scenario.maxRounds) || scenario.maxRounds < 1) throw new Error('剧本回合数无效');
  if (!Number.isInteger(scenario.summary.minPlayers) || !Number.isInteger(scenario.summary.maxPlayers) || scenario.summary.minPlayers < 1 || scenario.summary.maxPlayers < scenario.summary.minPlayers) throw new Error('剧本人数无效');
  for (const event of scenario.events) {
    if (seen.has(event.id)) throw new Error('事件ID重复'); seen.add(event.id);
    if (event.minRound < 1 || event.maxRound < event.minRound || event.maxRound > scenario.maxRounds) throw new Error('事件轮次无效');
    if (event.actions.length < 2 || event.actions.length > 3 || new Set(event.actions.map(action => action.id)).size !== event.actions.length) throw new Error('事件需要2～3个不同选择');
    if (!event.actions.some(action => action.id === event.defaultActionId && action.targetMode === 'none')) throw new Error('默认行动须无目标');
    if (!Number.isFinite(event.priority) || (event.weight !== undefined && (!Number.isFinite(event.weight) || event.weight <= 0))) throw new Error('事件优先级或权重无效');
    if (event.cues.some(cue => !Number.isFinite(cue.durationMs) || cue.durationMs < 0 || cue.durationMs > 30000) || new Set(event.cues.map(cue => cue.id)).size !== event.cues.length) throw new Error('演出配置无效');
  }
  if (!scenario.events.length) throw new Error('缺少事件');
  if (new Set(scenario.instructionTemplates?.map(value => value.id)).size !== (scenario.instructionTemplates?.length ?? 0)) throw new Error('指令模板ID重复');
}
validateScenario(seventhVisitor);
const registry = new Map<string, ScenarioDefinition>([[seventhVisitor.summary.id, seventhVisitor]]);
export function registerScenario(scenario: ScenarioDefinition): void { validateScenario(scenario); if (registry.has(scenario.summary.id)) throw new Error('剧本ID已注册'); registry.set(scenario.summary.id, scenario); }
export function getScenario(id: string): ScenarioDefinition { const value = registry.get(id); if (!value) throw new Error('未找到指定剧本'); return value; }
export function listScenarios(): ScenarioSummary[] { return [...registry.values()].map(value => ({ ...value.summary })); }
