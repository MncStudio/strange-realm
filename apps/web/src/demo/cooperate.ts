import type { ActionRequest, PrivateSnapshot, PublicSnapshot } from '@strange-realm/shared';
interface Participant { id: string; secret: PrivateSnapshot; submitted: boolean }
/** Owned demo clients only. This never feeds private information to the public pane. */
export function cooperationPlan(state: PublicSnapshot, participants: Participant[]): Map<string, ActionRequest> {
  const plan = new Map<string, ActionRequest>();
  const existing = participants.find(player => ['answer_door', 'force_door', 'purify'].includes(player.secret.submittedAction?.actionId || ''));
  let guarded = false;
  for (const player of participants.filter(value => !value.submitted)) {
    const options = player.secret.actions;
    let option = options.find(action => action.targetMode === 'none' && !['spread', 'sign_register', 'touch_mirror', 'answer_call', 'follow_shadow', 'force_door'].includes(action.id)) ?? options.find(action => action.targetMode === 'none');
    let targetId: string | undefined;
    if (existing && !guarded && existing.id !== player.id && options.some(action => action.id === 'protect')) {
      option = options.find(action => action.id === 'protect'); targetId = existing.id; guarded = true;
    } else if (player.secret.identity.kind === 'ordinary' && option?.id === 'purify') option = options.find(action => ['inspect_water', 'resist'].includes(action.id)) ?? option;
    const instruction = player.secret.instruction?.title;
    if (instruction === '它不想你洗掉名字' && options.some(action => action.id === 'protect')) {
      option = options.find(action => action.id === 'protect'); targetId = existing?.id !== player.id ? existing?.id : undefined;
    }
    if (instruction === '别把它叫出来' || instruction === '门认得你') option = options.find(action => ['inspect_knocks', 'inspect_register'].includes(action.id)) ?? option;
    if (instruction === '把它的话接下去') option = options.find(action => action.id === 'answer_call') ?? option;
    if (!option) continue;
    if (option.targetMode === 'none') targetId = undefined;
    if (option.targetMode === 'player' && !targetId) targetId = participants.find(value => value.id !== player.id)?.id;
    plan.set(player.id, { stageId: state.stageId, actionId: option.id, ...(targetId ? { targetId } : {}) });
  }
  return plan;
}
