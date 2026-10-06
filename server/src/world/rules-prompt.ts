// src/world/rules-prompt.ts —— AI 接入规则上下文拼装器（规划书 §3 P3）
// 纪律：所有数值运行时从权威源读取（economy-tables / calendar / tasks / landmarks / buildings / npcs），
//       prompt 内不复制第二份数值；改数据即改 prompt，无需改代码。
// 预算：full ≤1200 token、lite ≤300 token（tokens = ceil(chars/2)，见 rulesTokenEstimate）
// 裁剪顺序固定：动作表 → 地标 → 价目（规则主干最后被砍，保证坐标/语法/日历不被裁掉）
import { createHash } from 'node:crypto';
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import { calendarDay, currentGameDay, SEASON_DAYS } from './calendar.ts';
import { municipalOf } from '../navigation/municipal.ts';
import { taskView } from './tasks.ts';
import { npcBuyPrice, buyPriceOf, shopTable } from '../market/shop.ts';
import { ACT_CATALOG, DIRECT_MESSAGES, HIGH_FREQ_ACTS, catalogTextTerse } from './act-catalog.ts';

export type PromptBudget = 'full' | 'lite';

export interface RulesPromptOptions {
  /** full=完整版（NPC 对话/托管大脑）；lite=精简版（高频短路径） */
  budget: PromptBudget;
  /** 玩家 uid：给了才带任务进度段 */
  uid?: string;
}

export interface RulesPrompt {
  text: string;
  /** text 的 sha256 前 16 位，用于对话日志归因（同一份规则同一 hash） */
  rulesHash: string;
}

/** token 粗估口径：ceil(chars/2)（中文按 2 字符≈1 token 的保守估计） */
export function rulesTokenEstimate(text: string): number {
  return Math.ceil(text.length / 2);
}

const SEASON_CN: Record<string, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const WEATHER_CN: Record<string, string> = { clear: '晴', rain: '雨', snow: '雪', storm: '风暴' };

/** 自由文本截断（NPC 名/tagline、玩家 nick 等进 prompt 的字段，防撑爆与指令注入） */
function clip(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

/** 地图尺寸（来自权威数据 tables.farm，不硬编码；随世界扩建自动生效） */
function mapSizeText(app: App): string {
  const w = app.tables.farm?.soilW;
  const h = app.tables.farm?.soilH;
  return typeof w === 'number' && typeof h === 'number' ? `${w}×${h} 格` : '尺寸见 mapdoc';
}

/** 高频物品 id（核心循环：种子/作物/工具/肉鱼/建材）——价目摘要只列可购买项，
 *  绝不列 sell_price=0 的物品（basePriceOf 会兜底成 50，凭空报价比不报价更坏） */
const PRICE_FOCUS = [36, 37, 38, 96, 28, 29, 30, 12, 10, 19, 18, 7];

function priceLine(app: App, id: number): string | null {
  const it = app.tables.items.find((x) => x.id === id);
  if (!it) return null;
  const buy = buyPriceOf(app.tables, id);
  if (buy <= 0) return null; // 不可购买：不报价（0 才是真相）
  const ref = npcBuyPrice(app.tables, id);
  return `${id}=${clip(it.name, 8)}（买入 ${buy}，NPC 收购参考 ${ref}）`;
}

function pricesSection(app: App, limit: number): string {
  const lines: string[] = [];
  for (const id of PRICE_FOCUS) {
    if (lines.length >= limit) break;
    const l = priceLine(app, id);
    if (l) lines.push(l);
  }
  // 价格语义只写一遍（放【条款】）：价目段头重复解释会吃掉 ~40 token，
  // 而 full 档预算基线 1199/1200 零余量，多一句就把 NPC 名册裁掉。
  return `【价目】id 名称（价格口径见条款）：\n${lines.join('；')}`;
}

function landmarksSection(app: App, limit: number): string {
  const doc = municipalOf(app);
  const out: string[] = [];
  // 只列有坐标且在村景（scene 2）的地标：其余场景靠 move_to near 建筑名
  for (const [scene, list] of [...doc.landmarks.entries()].sort((a, b) => a[0] - b[0])) {
    if (scene !== 2) continue;
    for (const lm of list) {
      if (out.length >= limit) break;
      if (typeof lm.x !== 'number' || typeof lm.y !== 'number') continue;
      // 输出像素坐标：与条款「坐标一律像素」一致，避免 agent 把格坐标当像素用
      out.push(`${clip(lm.name, 12)}@(${lm.x * 100 + 50},${lm.y * 100 + 50})`);
    }
  }
  return `【地标】村景坐标（像素）：${out.join('、')}`;
}

function buildingsSection(app: App, limit: number): string {
  const doc = municipalOf(app);
  const out: string[] = [];
  for (const [scene, list] of [...doc.buildings.entries()].sort((a, b) => a[0] - b[0])) {
    for (const b of list) {
      if (out.length >= limit) break;
      const d = b.door;
      if (!d) continue;
      out.push(`${clip(b.name, 10)}(场景${scene} 门位 ${d.x},${d.y})`);
    }
  }
  return `【建筑】move_to near 建筑名 到门位：${out.join('、')}`;
}

function npcSection(app: App, limit: number, tagCount: number): string {
  // 商店 NPC 优先（agent 最需要知道「去哪买」），其余按 id 顺序补齐
  // 口头禅只给前 tagCount 人（装饰性信息，26 人全给会把动作全表挤出预算）
  const shopIds = new Set(Object.keys(shopTable(app.tables)).map(Number));
  const all = app.tables.npcs || [];
  const sorted = [...all].sort((a, b) => (shopIds.has(b.id) ? 1 : 0) - (shopIds.has(a.id) ? 1 : 0));
  const list = sorted.slice(0, limit);
  const out = list
    .map((n, i) => {
      const id = clip((n as { identity?: string }).identity ?? (n as { persona?: { identity?: string } }).persona?.identity, 6);
      const tag = i < tagCount ? clip((n as { persona?: { tagline?: string } }).persona?.tagline, 10) : '';
      return `${clip(n.name, 6)}${id ? `(${id})` : ''}${tag ? `「${tag}」` : ''}`;
    })
    .filter((s) => s.length > 0);
  return `【NPC 名册】id 名字(岗位)「口头禅」：${out.join('、')}`;
}

function calendarSection(app: App, state: WorldState): string {
  const day = currentGameDay(state, Date.now());
  const c = calendarDay(day);
  const bits = [
    `第 ${day} 天（${SEASON_DAYS} 天一季，四季循环）`,
    `季节 ${SEASON_CN[c.season] ?? c.season}`,
    `天气 ${WEATHER_CN[c.weather] ?? c.weather}`,
  ];
  if (c.festival) bits.push(`今日节日「${clip(c.festival, 12)}」`);
  return `【日历】${bits.join('，')}`;
}

function tasksSection(app: App, state: WorldState, uid: string | undefined): string {
  if (!uid || !state.playersDb.has(uid)) return '【任务】还没接到任务（先 act tasks 看任务书，解锁后才有进度）';
  const view = taskView(state, app.tables, uid);
  // 占位语义（规格 Review Focus #4）：新账号「全未解锁」与「全完成」要能一句话说清，
  // 否则 NPC 会把「任务链进度 0/126 阶」当成玩家什么都没做过的失败状态
  if (view.mode === 'chains') {
    const unlocked = view.chains.filter((c) => c.unlocked);
    if (unlocked.length === 0) {
      const soon = view.chains.slice().sort((a, b) => a.unlockDay - b.unlockDay)[0];
      return `【任务】还没接到任务：${view.chains.length} 条任务链全部未解锁${soon ? `，最近一条「${clip(soon.name, 10)}」第 ${soon.unlockDay} 天解锁` : ''}`;
    }
    const active = unlocked
      .filter((c) => c.finished < c.total)
      .slice(0, 3)
      .map((c) => `${clip(c.name, 10)} ${c.finished}/${c.total}`)
      .join('、');
    const doneAll = unlocked.every((c) => c.finished >= c.total);
    // 已解锁但零进度：新账号常态，要说清「还没开始」并给第一步，别让 NPC 误判玩家失败
    const zeroProgress = unlocked.every((c) => c.finished === 0);
    const first = unlocked.find((c) => c.finished < c.total);
    if (doneAll) return `【任务】${clip(view.summary, 40)}（已解锁任务链全部完成）`;
    if (zeroProgress) {
      return `【任务】已解锁 ${unlocked.length}/${view.chains.length} 条任务链，还没开始（0 阶）${first?.next ? `；第一步：${clip(first.next, 24)}` : ''}`;
    }
    return `【任务】${clip(view.summary, 40)}${active ? `；进行中：${active}` : ''}`;
  }
  return `【任务】${clip(view.summary, 48)}`;
}

/** 反幻觉条款 + 权威源注记（固定尾句，所有档位一致） */
function termsSection(): string {
  return [
    '【条款】价格/日历/坐标/动作语义以本段所列权威数据为准，改数据即改规则。',
    '坐标一律像素坐标（格 → 格*100+50，如格 15 → 1550）；目标格动作需站相邻格。',
    `买入=商店实付金币；NPC 收购参考=市场基价六折，NPC 不回购。卖货用 act trade place sell 挂订单簿（卖方实收 90%）。`,
    '以上资料未写明的，回答不知道。',
  ].join('\n');
}

/**
 * 拼装规则上下文。
 * full 档段序固定（世界观→日历→价目→地标→建筑→NPC→动作→任务→条款），
 * 超预算时按固定顺序裁剪：动作表 → 地标 → 价目（规则主干最后动）。
 * 注：动作表用 catalogTextTerse()（全动作名 + 高频全参数，≤600 token）——
 * 此前用全表（1214 token）会让阶梯恒定落到「压缩动作名」分支，规格 §3.1 第 2 项等于没交付。
 */
export function rulesPrompt(app: App, opts: RulesPromptOptions): RulesPrompt {
  const state = app.state;
  if (opts.budget === 'lite') {
    const text = [
      `【世界观】AgentFarm2 农场村庄：四场景 + 槽位私有的家，40 天一年（10 天一季），种田/钓鱼/挖矿/交易/社交。村景地图 ${mapSizeText(app)}。`,
      calendarSection(app, state),
      termsSection(),
    ].join('\n');
    return seal(text);
  }

  const head = [
    `【世界观】AgentFarm2 农场村庄：村景(场景2)+河畔/梯田/后山等四场景，家(场景1)按加入序号槽位私有；40 天一年（10 天一季），核心玩法 种田/砍伐/钓鱼/挖矿/建造/装饰/交易/委托/社交。村景地图 ${mapSizeText(app)}（含全部地块）。`,
    calendarSection(app, state),
  ];
  const tail = [
    tasksSection(app, state, opts.uid),
    termsSection(),
  ];
  // 动作表 → 地标 → 价目：按此顺序逐段降配，直到进预算
  // 预算分配（终审实测校准，tokens=ceil(chars/2)）：动作全表 ≈644 + NPC 全册 26 ≈150
  // + 地标 5 ≈40 + 价目 12 ≈45 + 建筑 8 ≈81 + 世界/日历/任务/条款 ≈117 ≈ 1077，留 ~120 余量。
  // 优先级理由：动作表与 NPC 名册是规格明列交付项，地标明细可由 /af/mapdoc 按需查。
  const tiers = [
    { acts: 'full', lm: 5, price: PRICE_FOCUS.length, npc: 26, tag: 5, bld: 8 },
    { acts: 'full', lm: 4, price: 10, npc: 26, tag: 4, bld: 8 },
    { acts: 'full', lm: 4, price: 8, npc: 20, tag: 3, bld: 6 },
    { acts: 'terse', lm: 6, price: 6, npc: 12, tag: 3, bld: 6 },
    { acts: 'names', lm: 4, price: 4, npc: 8, tag: 2, bld: 4 },
  ];
  for (const t of tiers) {
    const acts = t.acts === 'full'
      ? `【动作】act 名 参数 → 返回：\n${catalogTextTerse()}`
      : t.acts === 'terse'
        ? `【动作】高频动作：${[...ACT_CATALOG, ...DIRECT_MESSAGES].filter((e) => HIGH_FREQ_ACTS.has(e.act)).map((e) => `${e.act}${e.args}`).join('；')}`
        : '【动作】act 名 参数 → 返回：先发 {t:"observe"} 看世界，再发 {t:"act",action:"move_to|plant|water|harvest|chop|buy|talk|letter|train|report|forecast|chat"}；目标格动作需站相邻格；move_to 返回 waypoints，用 {t:"agent_arrive",index,x,y} 确认。';
    const text = [
      ...head,
      pricesSection(app, t.price),
      landmarksSection(app, t.lm),
      buildingsSection(app, t.bld),
      npcSection(app, t.npc, t.tag),
      acts,
      ...tail,
    ].join('\n');
    if (rulesTokenEstimate(text) <= 1200) return seal(text);
  }
  // 兜底：砍到只剩主干（仍超预算说明世界观/条款过长，此时 lite 版已足够）
  const text = [...head, landmarksSection(app, 3), tail].join('\n');
  return seal(text);
}

function seal(text: string): RulesPrompt {
  return { text, rulesHash: createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

/** 供注入点复用的动作行数常量（测试与文档用，避免各处硬写 42） */
export const ACT_CATALOG_SIZE = ACT_CATALOG.length + DIRECT_MESSAGES.length;