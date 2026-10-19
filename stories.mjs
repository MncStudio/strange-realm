import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const mapText = (value, render) => {
  if (typeof value === 'string') return render(value);
  if (Array.isArray(value)) return value.map(item => mapText(item, render));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapText(item, render)]));
  return value;
};
const roleReference = /\{\{role:([a-zA-Z0-9-]+)\}\}/g;

// 只替换作者写入的角色引用；昵称不会再次解析，玩家自己输入的说法也不经此函数。
export function personalizeStory(story, players) {
  const names = new Map(story.roles.map(role => [role.id, players.find(p => p.roleId === role.id)?.nickname ?? role.name]));
  const rendered = mapText(story, text => text.replace(roleReference, (_, id) => names.get(id)));
  for (const role of rendered.roles) role.name = names.get(role.id);
  return rendered;
}

export function validateStory(s) {
  const assert = (ok, message) => { if (!ok) throw new Error(`故事配置错误：${message}`); };
  const strings = (items) => Array.isArray(items) && items.every(x => typeof x === 'string' && x.length > 0);
  assert(s && typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id), 'id须为英文小写、数字或连字符');
  for (const key of ['title', 'tagline', 'description', 'duration', 'opening']) assert(typeof s[key] === 'string' && s[key], key);
  assert(Number.isInteger(s.players) && s.players >= 3 && s.players <= 8, '人数范围3～8');
  const unique = (items, name) => {
    assert(Array.isArray(items) && items.length > 0, `${name}不能为空`);
    assert(items.every(x => x && typeof x.id === 'string' && /^[a-zA-Z0-9-]+$/.test(x.id)), `${name}的id`);
    assert(new Set(items.map(x => x.id)).size === items.length, `${name}的id重复`);
  };
  unique(s.roles, '角色'); unique(s.locations, '地点'); unique(s.evidence, '证据'); unique(s.reasonOptions, '判断');
  assert(s.roles.length === s.players, '角色数应等于人数');
  for (const r of s.roles) {
    assert(['name', 'brief', 'intro', 'testimony'].every(k => typeof r[k] === 'string'), '角色文案');
    assert(typeof r.isCulprit === 'boolean' && Array.isArray(r.dossier) && r.dossier.length > 0, '私人档案');
    assert(r.dossier.every(x => typeof x.label === 'string' && typeof x.text === 'string'), '档案段落');
  }
  assert(s.roles.filter(r => r.isCulprit).length === 1, '本版本支持一名凶手');
  assert(s.roles.some(r => r.id === s.answer?.culpritId && r.isCulprit), '凶手答案');
  assert(s.reasonOptions.some(r => r.id === s.answer?.reasonId), '推断答案');
  assert(s.reasonOptions.every(r => typeof r.text === 'string'), '判断文案');
  for (const l of s.locations) assert(typeof l.name === 'string' && typeof l.note === 'string', '地点文案');
  for (const e of s.evidence) {
    assert(e.verification === undefined || typeof e.verification === 'string' && e.verification, '可选核验原文');
    assert([1, 2].includes(e.round) && s.locations.some(l => l.id === e.locationId), '证据地点和轮次');
    assert(['title', 'text', 'question'].every(k => typeof e[k] === 'string'), '证据文案');
    assert(e.hints && typeof e.hints === 'object' && !Array.isArray(e.hints), '私人提示');
    assert(Object.entries(e.hints).every(([id, hint]) => s.roles.some(r => r.id === id) && typeof hint === 'string'), '提示角色');
  }
  for (const l of s.locations) for (const round of [1, 2]) assert(s.evidence.filter(e => e.locationId === l.id && e.round === round).length === 1, '每个地点每轮须恰有一份物证');
  assert(strings(s.rules) && strings(s.hints), '规则和提示');
  assert(Array.isArray(s.anchors) && s.anchors.every(x => typeof x.time === 'string' && typeof x.text === 'string'), '开场时间');
  assert(Array.isArray(s.replay) && s.replay.length > 0 && s.replay.every(x => typeof x.title === 'string' && typeof x.text === 'string' && Array.isArray(x.evidence) && x.evidence.every(id => s.evidence.some(e => e.id === id))), '复盘与引用');
  assert(Array.isArray(s.timeline) && s.timeline.every(x => ['time', 'text', 'source'].every(k => typeof x[k] === 'string')), '时间线');
  assert(s.stageNotes && ['dossier', 'opening', 'search1', 'search2', 'confrontation', 'vote', 'ended'].every(k => typeof s.stageNotes[k] === 'string'), '阶段引导');
  assert(s.playMode === undefined || ['classic', 'screen-led'].includes(s.playMode), '主持模式');
  assert(s.flowVersion === undefined || s.flowVersion === 2 && s.playMode === 'screen-led', '交谈模式版本');
  if (s.flowVersion === 2) {
    assert(s.conversation && s.conversation.notes && ['opening', 'dossier', 'search1', 'search2', 'vote', 'ended'].every(k => typeof s.conversation.notes[k] === 'string'), '交谈阶段引导');
    assert(s.conversation.beats && ['search1', 'search2'].every(k => ['title', 'text'].every(f => typeof s.conversation.beats[k]?.[f] === 'string')), '剧情新发现');
    assert(s.roles.every(r => typeof r.actionCard?.starter === 'string' && r.actionCard.starter), '私人开口方向');
  }
  if (s.playMode === 'screen-led') {
    assert(s.briefing && ['background', 'scene'].every(k => typeof s.briefing[k] === 'string' && s.briefing[k]) && strings(s.briefing.rules), '公共导读');
    assert(Array.isArray(s.briefing.relations) && s.briefing.relations.length === s.players && new Set(s.briefing.relations.map(r => r.roleId)).size === s.players && s.briefing.relations.every(r => s.roles.some(role => role.id === r.roleId) && typeof r.text === 'string'), '公开关系');
    assert(s.screenNotes && ['opening', 'dossier', 'search1', 'search2', 'confrontation', 'vote', 'ended'].every(k => typeof s.screenNotes[k] === 'string'), '公共屏阶段引导');
    for (const r of s.roles) {
      const card = r.actionCard;
      assert(card && typeof card.goal === 'string' && card.goal && strings(card.facts) && card.facts.length > 0 && card.facts.length <= 3 && strings(card.boundaries), '私人行动卡');
      assert(card.focus && ['dossier', 'search1', 'search2', 'confrontation', 'vote', 'ended'].every(k => typeof card.focus[k] === 'string'), '私人行动方向');
      assert(Array.isArray(card.history) && card.history.every(p => typeof p.label === 'string' && typeof p.text === 'string'), '完整经历');
    }
    for (const e of s.evidence) assert(e.screenHints && s.roles.every(r => typeof e.screenHints[r.id] === 'string'), '证据应对方向');
    assert(Array.isArray(s.screenReplay) && s.screenReplay.length > 0 && s.screenReplay.every(p => typeof p.title === 'string' && typeof p.text === 'string' && Array.isArray(p.evidence) && p.evidence.every(id => s.evidence.some(e => e.id === id))), '公共屏复盘');
  }
  mapText(s, text => {
    const rest = text.replace(roleReference, (_, id) => { assert(s.roles.some(r => r.id === id), `未知角色引用${id}`); return ''; });
    assert(!rest.includes('{{role:'), '角色引用格式须为{{role:角色id}}');
    return text;
  });
  return s;
}

export function loadStories(directory = fileURLToPath(new URL('./stories/', import.meta.url)), filename = 'story.json') {
  const stories = new Map();
  for (const folder of readdirSync(directory, { withFileTypes: true })) {
    if (!folder.isDirectory() || !/^[a-z0-9-]+$/.test(folder.name)) continue;
    const selected = join(directory, folder.name, filename);
    const story = validateStory(JSON.parse(readFileSync(existsSync(selected) ? selected : join(directory, folder.name, 'story.json'), 'utf8')));
    if (stories.has(story.id)) throw new Error(`剧本id重复：${story.id}`);
    stories.set(story.id, story);
  }
  if (!stories.size) throw new Error('没有找到故事，请在stories中放入故事文件夹。');
  return stories;
}

// 只把目录摘要交给浏览器，不导出原始故事、秘密或答案。
export function storySummary(s) {
  return { id: s.id, title: s.title, tagline: s.tagline, description: s.description, players: s.players, duration: s.duration };
}
