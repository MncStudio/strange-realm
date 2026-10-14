import type { EnginePlayer, EvaluationContext, RoundContext, RandomSource, InternalInstruction } from '@strange-realm/game-engine';
import type { ActionOption } from '@strange-realm/shared';
import data from './scenario.json';
const exposure = (player: EnginePlayer) => Number(player.state.exposure ?? 0);
const labels = ['正常人类', '潜伏感染', '异常觉醒', '怪物异变'];
const spread: ActionOption = { id: 'spread', label: '把异常引向另一人', description: '让异常接触一名同伴。护持与抵抗可以阻止它；你也可以选择帮助别人。', targetMode: 'player' };
function fact(ctx: RoundContext, id: string, title: string, text: string): void { if (!ctx.world.facts.has(id)) { ctx.world.facts.add(id); ctx.publicResult(title, text); ctx.audit('故事事实', `${id}：${text}`); } }
export function initialize(ctx: EvaluationContext, _rng: RandomSource): void {
  ctx.world.values.purifications = ctx.players.size === 6 ? 3 : 2;
  for (const player of ctx.players.values()) { player.state = { exposure: 0, escaped: false, helped: 0, spread: 0, resisted: 0 }; player.instruction = null; }
}
export function createInstructions(ctx: EvaluationContext, rng: RandomSource): void {
  if (!ctx.event || ctx.round < 2 || ctx.round === ctx.maxRounds) return;
  const ordered = rng.shuffle([...ctx.players.values()].sort((a,b) => a.id.localeCompare(b.id)));
  const cap = Math.floor(ctx.players.size / 2);
  const instruction = (id: string): InternalInstruction => {
    const template = data.instructionTemplates.find(value => value.id === id);
    if (!template) throw new Error(`缺少指令模板${id}`);
    return { id, view: { ...template.view }, data: {} };
  };
  if (ctx.event.tags.includes('knock')) {
    const first = ordered.find(player => player.state.investigated && !player.state.registered) ?? ordered.find(player => player.state.registered || player.state.investigated) ?? ordered[0]!;
    first.instruction = instruction('another_answers');
    const other = ordered.find(player => player !== first && player.state.registered);
    if (cap > 1 && other) other.instruction = instruction('nobody_answers');
  } else if (ctx.event.tags.includes('purification')) {
    const candidate = ordered.find(player => player.state.helped && !player.state.purificationInstruction);
    if (candidate) {
      candidate.state.purificationInstruction = true;
      candidate.instruction = instruction('protect_other');
    }
  } else if (ctx.event.tags.includes('voice')) {
    const candidate = ordered.find(player => player.state.contacted);
    if (candidate) candidate.instruction = instruction('answer_call');
  }
}
export function getActions(ctx: EvaluationContext, player: EnginePlayer): ActionOption[] {
  if (!ctx.event) return [];
  // Choices depend on disclosed knowledge, never undisclosed latent infection.
  const options = ctx.event.actions.map(action => ({ ...action }));
  if (player.knowledge.identity.kind === 'changed' && ctx.event.tags.includes('contact') && !ctx.event.tags.includes('final')) {
    const replace = options.findIndex(action => !['protect', 'purify', ctx.event!.defaultActionId].includes(action.id));
    if (replace >= 0) options[replace] = spread;
  }
  return options;
}
export function resolveRound(ctx: RoundContext): void {
  const { players, actions, world, event } = ctx;
  const beginning = new Map([...players.values()].map(player => [player.id, exposure(player)]));
  const original = new Map(beginning); const guardCharges = new Map<string, number>(); const protectedBy = new Map<string, string[]>(); const incoming = new Map<string, string[]>();
  const contact = (id: string, reason: string, guarded = true) => {
    const target = players.get(id)!;
    if (guarded && ((guardCharges.get(id) ?? 0) > 0 || actions.get(id)?.actionId === 'resist')) {
      if (actions.get(id)?.actionId !== 'resist') guardCharges.set(id, (guardCharges.get(id) ?? 0) - 1);
      ctx.privateResult(id, '护持或主动抵抗挡住了这次异常接触。'); ctx.audit('接触被抵挡', reason, id); return;
    }
    incoming.set(id, [...(incoming.get(id) ?? []), reason]); target.state.contacted = true;
    ctx.audit('异常原因', reason, id);
  };
  for (const player of ctx.orderedPlayers) {
    const request = actions.get(player.id)!;
    if (request.actionId === 'protect' && request.targetId) {
      protectedBy.set(request.targetId, [...(protectedBy.get(request.targetId) ?? []), player.id]);
      guardCharges.set(request.targetId, (guardCharges.get(request.targetId) ?? 0) + 1);
      player.state.helped = Number(player.state.helped) + 1;
      ctx.privateResult(player.id, `你为${players.get(request.targetId)!.nickname}护持，阻止本轮异常接触，也能帮助其净化。`);
      ctx.privateResult(request.targetId, `${player.nickname}选择护持你。`);
    }
    if (request.actionId === 'resist') { player.state.resisted = Number(player.state.resisted) + 1; ctx.privateResult(player.id, '你没有回应，努力保住自己的意识。违抗私人指令的后果仍会判定。'); }
  }
  for (const player of ctx.orderedPlayers) if (actions.get(player.id)!.actionId === 'purify') {
    const remaining = Number(world.values.purifications);
    if (!event.tags.includes('purification')) throw new Error('本事件不提供净化');
    if (remaining <= 0) { ctx.privateResult(player.id, '净化机会已用完。这次没有消耗机会；你仍可以抵抗并帮助别人。'); continue; }
    const before = beginning.get(player.id)!;
    if (before === 3 && !protectedBy.has(player.id)) {
      ctx.privateResult(player.id, '你的异变被暂时压住，但彻底净化需要另一人同轮护持。没有消耗机会。'); player.state.resisted = Number(player.state.resisted) + 1; continue;
    }
    world.values.purifications = remaining - 1; player.state.exposure = before === 3 ? 1 : 0;
    if (before >= 2) player.knowledge.identity = { kind: 'uncertain', label: '正在恢复的访客', explanation: '异变的征兆减弱，但你还不能确认自己是否完全恢复。' };
    ctx.privateResult(player.id, '水中的另一张脸消退了。你使用了一次净化机会；不能据此确认此前是否感染，也不能防住之后的新接触。');
    ctx.audit('净化', `已有状态 ${labels[before]} → ${labels[exposure(player)]}；剩余机会${remaining - 1}`, player.id);
    ctx.publicResult('水面平静', '有人使用了净化机会。机会不会因为坦白而增加。');
  }
  for (const player of ctx.orderedPlayers) {
    const request = actions.get(player.id)!;
    switch (request.actionId) {
      case 'inspect_register':
        player.state.investigated = true; fact(ctx, 'manifest_confirmed', '登记真相', '第七行的名字指向旅馆本身。');
        ctx.clue(player.id, '登记簿的第七行不是普通住客。不要把广播当成可靠证人。'); ctx.privateResult(player.id, '你找到了登记涂改的依据。'); break;
      case 'sign_register': player.state.registered = true; contact(player.id, '在不明登记簿签下名字'); ctx.privateResult(player.id, '墨迹顺着手指向上爬，登记簿记住了你。'); break;
      case 'answer_door':
        world.facts.add('door_answered'); fact(ctx, 'door_released', '门禁松动', '循环被打断，但门内开始学你们的声音。'); contact(player.id, '回应门后的第七位访客'); ctx.privateResult(player.id, '你回应了房门，门禁循环被打断。'); break;
      case 'inspect_knocks': ctx.clue(player.id, '敲击来自旅馆内部。回应者可能接触异常，护持能挡住一次接触。'); ctx.privateResult(player.id, '你没有回应，记下了声音的条件。'); break;
      case 'check_recording': ctx.clue(player.id, '广播多出的笑声来自旅馆，不是同伴提交行为的证据。'); ctx.privateResult(player.id, '录音证实旅馆能模仿你们，不应仅凭声音指认别人。'); break;
      case 'trace_wires': fact(ctx, 'door_released', '循环解除', '墙内线路露出真实门禁，绕行不再回到前台。'); ctx.privateResult(player.id, '你用查证解开了门禁，不必靠回应声音。'); break;
      case 'force_door': fact(ctx, 'door_released', '门禁拆开', '错误的门禁被拆开。'); contact(player.id, '强拆异常门禁'); ctx.privateResult(player.id, '循环解开，但你触碰了门禁中的异常。'); break;
      case 'inspect_water':
        ctx.clue(player.id, '净化处理已有异常；异变者需要另一人同轮护持。寒冷也能让正常人出现类似征兆。');
        if (!player.knowledge.symptoms.includes('有时，你的回声比你先开口。')) player.knowledge.symptoms.push('有时，你的回声比你先开口。');
        if (!player.knowledge.symptoms.includes('冰冷的水让你的手微微发抖。')) player.knowledge.symptoms.push('冰冷的水让你的手微微发抖。');
        ctx.privateResult(player.id, `你核对了净化规则。当前还剩${world.values.purifications}次机会，颤抖本身不能证明感染。`); break;
      case 'verify_mirror': case 'verify_echo':
        if (world.facts.has('manifest_confirmed') && world.facts.has('door_released')) fact(ctx, 'boundary_verified', '边界核验', '出口和倒影的差异被找到，门外的雨有了真实方向。');
        ctx.privateResult(player.id, world.facts.has('boundary_verified') ? '你验证了边界。最终仍需要决定如何离开，以及要不要接纳别人。' : '登记或门禁仍缺少查证，不能把这个出口当成安全边界。'); break;
      case 'follow_shadow': fact(ctx, 'manifest_confirmed', '影子的登记', '影子回到第七行，补全了登记异常的依据。'); contact(player.id, '跟随没有主人的影子'); break;
      case 'touch_mirror': ctx.clue(player.id, '镜中的出口比真实边界提前一步。'); contact(player.id, '接触异常镜面'); ctx.privateResult(player.id, '镜面冰凉，你获得线索，也承担了接触风险。'); break;
      case 'answer_call': contact(player.id, '回应模仿自己的广播'); ctx.clue(player.id, '模仿的声音需要有人接话，它不是同伴的直接证据。'); ctx.privateResult(player.id, '声音把你的名字说完整了。'); break;
      case 'spread':
        if (original.get(player.id) !== 3 || !request.targetId || !event.tags.includes('contact')) throw new Error('不能使用尚未觉醒的传播能力');
        contact(request.targetId, '另一位访客主动将异常引向你'); player.state.spread = Number(player.state.spread) + 1;
        ctx.privateResult(player.id, '你选择把异常引向另一人；若对方护持或抵抗，传播会失败。'); ctx.audit('主动选择传播', `目标${players.get(request.targetId)!.nickname}`, player.id); break;
    }
  }
  for (const player of ctx.orderedPlayers) if (player.instruction) {
    const instruction = player.instruction;
    const action = actions.get(player.id)!.actionId;
    const complied = instruction.id === 'another_answers'
      ? action !== 'answer_door' && [...actions].some(([id, request]) => id !== player.id && request.actionId === 'answer_door')
      : instruction.id === 'nobody_answers' ? ![...actions.values()].some(request => request.actionId === 'answer_door')
        : instruction.id === 'protect_other' ? action === 'protect' : instruction.id === 'answer_call' ? action === 'answer_call' : false;
    ctx.privateResult(player.id, complied ? '本轮满足了你收到的私人指令。这不代表所有人都安全。' : '你没有满足私人指令。身后的声音离你近了一步。');
    ctx.audit('私人指令', `${instruction.view.text} 实际${complied ? '满足' : '违抗'}。`, player.id);
    if (!complied) contact(player.id, `违抗私人指令：${instruction.view.title}`, false);
    else player.state.complied = Number(player.state.complied ?? 0) + 1;
  }
  for (const player of ctx.orderedPlayers) {
    const before = exposure(player); const reasons = incoming.get(player.id) ?? [];
    if (reasons.length) {
      const after = Math.min(3, before + 1); player.state.exposure = after;
      if (!player.knowledge.symptoms.includes('有时，你的回声比你先开口。')) player.knowledge.symptoms.push('有时，你的回声比你先开口。');
      ctx.privateResult(player.id, '你听到自己的回声比你先开口。这是需要留意的征兆。');
      ctx.audit('真实状态变化', `${labels[before]} → ${labels[after]}；本轮原因${reasons.length}项，最多进一阶。`, player.id);
      if (after === 2) player.knowledge.identity = { kind: 'awakened', label: '异常正在觉醒', explanation: '你已经明确感到异常进入身体。仍可抵抗、净化或帮助别人，不必伤害同伴。' };
      if (after === 3) player.knowledge.identity = { kind: 'changed', label: '你已经异变', explanation: '你能把异常引向别人，也能拒绝传播、护持同伴或请求净化。立场由你选择。' };
    }
  }
  if (event.tags.includes('purification')) ctx.publicResult('净化机会', `目前还剩${world.values.purifications}次。没有得到机会的人也能继续抵抗。`);
  if (event.tags.includes('final')) {
    const requests = [...actions.values()];
    if (world.facts.has('manifest_confirmed') && world.facts.has('door_released') && requests.filter(request => request.actionId === 'verify_leave').length >= 2) fact(ctx, 'boundary_verified', '最后查验', '两人核对了边界，门外的雨不再是倒影。');
    const open = ['manifest_confirmed','door_released','boundary_verified'].every(id => world.facts.has(id));
    const stayers = requests.filter(request => request.actionId === 'stay').length;
    if (stayers >= Math.ceil(players.size / 2)) world.facts.add('contained');
    for (const player of players.values()) {
      const action = actions.get(player.id)!.actionId;
      const escaped = open && (action === 'direct_leave' || (action === 'verify_leave' && exposure(player) === 0));
      player.state.escaped = escaped;
      const missing = [['manifest_confirmed','登记异常'],['door_released','门禁循环'],['boundary_verified','出口边界']].filter(([id]) => !world.facts.has(id!)).map(([,label]) => label).join('、');
      ctx.privateResult(player.id, escaped ? '你通过了旅馆的边界。接下来会揭晓真正带走了什么。' : action === 'stay' ? '你选择留下，尝试让异常留在旅馆。' : !open ? `你没能离开：还没有查明${missing}。` : '边界的查验在你身上发现了异常。你留在旅馆，阻止它随你出去。');
      ctx.audit('撤离选择', `${action}；${escaped ? '已通过边界' : '留在旅馆'}`, player.id);
    }
    ctx.publicResult('退房广播', '最后的选择已经完成。看完本人的结果，再一起揭晓真相。');
  }
  if (!ctx.event.tags.includes('final')) ctx.publicResult('这一幕之后', describeSituation(ctx));
}
export function describeSituation(ctx: EvaluationContext): string {
  if (!ctx.world.facts.has('manifest_confirmed')) return '还没查清登记异常。接下来遇到登记或影子线索时，先核对它。';
  if (!ctx.world.facts.has('door_released')) return '登记已查明，但门禁仍在循环。回应声音或查维修线路都可能推进，风险不同。';
  if (!ctx.world.facts.has('boundary_verified')) return '门禁已解除，还需要查验镜面或回声，区分出口和倒影。';
  return '逃生依据已齐。仍要留意征兆、分配有限净化，并决定最后如何离开。';
}
export function evaluateEnding(ctx: EvaluationContext, forced: boolean) {
  if (!forced) return null;
  const players = [...ctx.players.values()]; const out = players.filter(player => player.state.escaped);
  if (out.some(player => exposure(player) > 0)) return { id: 'carried-out', title: '第七位访客随你们退房', narrative: '雨是真的，路也是真的。只是走出旅馆的人，比来时多了一道影子。', collectiveSuccess: false };
  if (out.length === players.length) return { id: 'safe-dawn', title: '登记之外的黎明', narrative: '你们带着查证与帮助走出边界。第七行留在旅馆，没有再写出下一个名字。', collectiveSuccess: true };
  if (ctx.world.facts.has('contained')) return { id: 'sealed-hotel', title: '有人把门留在里面', narrative: '你们没能一起离开。但留下的人让异常停在旅馆，雨中的世界没有多出第七位访客。', collectiveSuccess: false };
  if (out.length) return { id: 'new-guests', title: '门外少了几个人', narrative: '出口已经打开，有人通过了边界，有人留下。旅馆没有多带走一道影子，但你们也没有一起回来。', collectiveSuccess: false };
  return { id: 'new-guests', title: '旅馆仍在等下一桌人', narrative: '登记与出口没能同时成为真相。旅馆留下了还没走出去的人，也留下了他们的声音。', collectiveSuccess: false };
}
export function evaluatePlayer(_ctx: EvaluationContext, player: EnginePlayer) {
  const stage = exposure(player);
  return { identity: labels[stage]!, escaped: !!player.state.escaped,
    reason: `${player.state.escaped ? '已离开' : '留在旅馆'}；真实状态：${labels[stage]}。异变不是自动背叛，实际选择见回放。`,
    choices: [`护持同伴${player.state.helped ?? 0}次`, `主动抵抗${player.state.resisted ?? 0}次`, `主动引导传播${player.state.spread ?? 0}次`] };
}
