// src/world/dialogue-prompt.ts —— NPC 对话 / 托管计划的 system 提示词装配（批2 P3 Task4）
// 拆出来是为了可测：ws.ts 里那段 system 拼装内联在巨型 act 处理器中，无法单测。
// 规则段一律来自 rulesPrompt（权威源），本文件只做「人设 + 现场 + 规则」三段编排。
import type { RulesPrompt } from './rules-prompt.ts';

/** 人设/现场字段统一消毒（去换行 + 长度截断）：NPC 数据与 gossip 会直进 system，
 *  一条带换行的注入句就能把 system 后的指令分隔掉 */
function clip(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

export interface NpcPromptCtx {
  npcName: string;
  /** npcs.json 的 persona 字段均可选（缺失按「未设」处理，不让 undefined 拼进 system） */
  identity?: string;
  tagline?: string;
  desc?: string;
  day: number;
  seasonCn: string;
  weatherCn: string;
  festival: string | null;
  gossip: string | null;
}

/** NPC 对话 system（完整版规则 ≤1200 token 预算由 rulesPrompt 保证） */
export function npcDialoguePrompt(ctx: NpcPromptCtx, rules: RulesPrompt): string {
  const fest = ctx.festival ? `，今天是「${clip(ctx.festival, 12)}」节` : '';
  const gossip = ctx.gossip ? `村里最近的事：${clip(ctx.gossip, 60)}（可顺带一提）。` : '';
  const who = [
    clip(ctx.npcName, 8),
    ctx.identity ? clip(ctx.identity, 12) : '村民',
    ctx.tagline ? `口头禅：${clip(ctx.tagline, 24)}。` : '',
    ctx.desc ? `性格：${clip(ctx.desc, 60)}` : '',
  ].filter(Boolean).join('，');
  return [
    `${who}。`,
    `当前：第${ctx.day}天 ${ctx.seasonCn}季、${ctx.weatherCn}${fest}。${gossip}`,
    '用村民口吻说话，中文回答；问到价格/坐标/怎么做事，先按下面【规则】里的权威数据回答，别自己编。',
    '',
    rules.text,
  ].join('\n');
}

/** 托管次日计划的 system（精简档规则 ≤300 token：规划只需要日历与主干） */
export function plannerSystemPrompt(rules: RulesPrompt): string {
  return [
    '你是像素农场游戏的角色规划器。根据人设/天气/节日/记忆/倾向动作，输出明日 3-5 条可执行计划（简短中文，每行一条，不要编号前缀以外的内容）。',
    '计划里的动作名、价格、坐标必须用下面【规则】里的写法，别自己编。',
    '',
    rules.text,
  ].join('\n');
}