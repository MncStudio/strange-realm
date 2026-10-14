import type { ActionOption, ActionRequest, IdentityKnowledge, InstructionView, PresentationCue, PublicEvent, PersonalOutcome } from '@strange-realm/shared';
export interface RandomSource { next(): number; int(max: number): number; shuffle<T>(values: T[]): T[] }
export type StateValue = string | number | boolean | null;
export interface WorldState { facts: Set<string>; values: Record<string, StateValue> }
export interface PlayerKnowledge { identity: IdentityKnowledge; symptoms: string[]; clues: string[] }
export interface InternalInstruction { id: string; view: InstructionView; data: Record<string, StateValue> }
export interface EnginePlayer { id: string; nickname: string; connected: boolean; ready: boolean; state: Record<string, StateValue>; knowledge: PlayerKnowledge; instruction: InternalInstruction | null }
export interface EventDefinition extends PublicEvent {
  minRound: number; maxRound: number; priority: number; weight?: number; tags: string[];
  requiresFacts?: string[]; absentFacts?: string[];
  actions: ActionOption[]; defaultActionId: string; cues: PresentationCue[];
}
export interface EvaluationContext { world: WorldState; players: Map<string, EnginePlayer>; round: number; maxRounds: number; event: EventDefinition | null }
export interface RoundContext extends EvaluationContext {
  event: EventDefinition; actions: Map<string, ActionRequest>; rng: RandomSource;
  orderedPlayers: EnginePlayer[];
  privateResult(id: string, text: string): void;
  publicResult(title: string, text: string): void;
  audit(title: string, detail: string, playerId?: string): void;
  clue(id: string, text: string): void;
}
export interface EndingDefinition { id: string; title: string; narrative: string; collectiveSuccess: boolean }
export interface ScenarioDefinition {
  summary: import('@strange-realm/shared').ScenarioSummary; intro: string; goal: string;
  publicRules: string[]; introCues: PresentationCue[]; maxRounds: number;
  instructionTemplates?: { id: string; view: InstructionView }[];
  factLabels: Record<string, string>; events: EventDefinition[];
  initialWorld: Record<string, StateValue>;
  initialize(ctx: EvaluationContext, rng: RandomSource): void;
  createInstructions(ctx: EvaluationContext, rng: RandomSource): void;
  getActions(ctx: EvaluationContext, player: EnginePlayer): ActionOption[];
  resolveRound(ctx: RoundContext): void;
  evaluateEnding(ctx: EvaluationContext, forced: boolean): EndingDefinition | null;
  evaluatePlayer(ctx: EvaluationContext, player: EnginePlayer): Omit<PersonalOutcome, 'playerId' | 'nickname'>;
  describeSituation(ctx: EvaluationContext): string;
  resultCues?(ctx: EvaluationContext, consequences: string[]): PresentationCue[];
}
