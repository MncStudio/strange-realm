/** Network projections only. Authoritative player/world state never crosses this boundary. */
export type Phase = 'lobby' | 'introduction' | 'event' | 'action' | 'resolution' | 'ended';
export interface ScenarioSummary { id: string; title: string; subtitle: string; synopsis: string; minPlayers: number; maxPlayers: number; estimatedMinutes: string }
export interface PublicPlayer { id: string; nickname: string; connected: boolean; ready: boolean; submitted: boolean; read: boolean }
export interface ActionOption { id: string; label: string; description: string; targetMode: 'none' | 'player' }
export interface ActionRequest { stageId: number; actionId: string; targetId?: string }
export interface StageRequest { stageId: number }
export interface PresentationCue { id: string; kind: 'text' | 'blackout' | 'sound' | 'pause'; text?: string; sound?: 'knock' | 'hum' | 'chime' | 'heartbeat'; durationMs: number }
export interface PublicEvent { id: string; title: string; narrative: string; dilemma: string; hint: string }
export interface LogEntry { round: number; title: string; text: string }
export interface InstructionView { title: string; text: string; warning: string }
export interface IdentityKnowledge { kind: 'ordinary' | 'uncertain' | 'awakened' | 'changed'; label: string; explanation: string }
export interface PersonalOutcome { playerId: string; nickname: string; identity: string; escaped: boolean; reason: string; choices: string[] }
export interface Ending { id: string; title: string; narrative: string; collectiveSuccess: boolean; outcomes: PersonalOutcome[] }
export interface ReplayEntry { round: number; event: string; actions: { nickname: string; action: string; result: string }[]; causes: { nickname?: string; title: string; detail: string }[]; consequences: string[] }
export interface RoundReport { round: number; event: string; summary: string; consequences: string[]; nextStep: string; endingPending: boolean }
export interface PublicSnapshot {
  roomId: string; code: string; scenario: ScenarioSummary; phase: Phase; stageId: number;
  round: number; maxRounds: number; serverNow: number; players: PublicPlayer[];
  submittedCount: number; readCount: number; intro: string; goal: string;
  facts: string[]; publicRules: string[]; event: PublicEvent | null;
  cues: PresentationCue[]; presentationDone: boolean; log: LogEntry[];
  roundReport: RoundReport | null; ending: Ending | null; replay: ReplayEntry[];
}
export interface PrivateSnapshot {
  playerId: string; identity: IdentityKnowledge; instruction: InstructionView | null;
  actions: ActionOption[]; submittedAction: ActionRequest | null;
  symptoms: string[]; clues: string[]; results: LogEntry[]; outcome: PersonalOutcome | null;
}
export interface SessionInfo { kind: 'host' | 'player'; playerId: string | null }
export interface ServerError { message: string; code?: string }
export const ROOM_TYPE = 'realm';
export const MESSAGES = {
  public: 'public', private: 'private', session: 'session', error: 'error', sync: 'sync',
  ready: 'ready', start: 'start', advance: 'advance', action: 'action', reset: 'reset',
  presentationDone: 'presentation_done', ackRead: 'ack_read', skipDisconnected: 'skip_disconnected'
} as const;
