// world/economy-gates.ts —— 经济类钩子冻结闸（M-B1 影子观察窗）
//
// 背景（2026-10-03 审计发现）：`data/buildings.json` 的 hooks 与 MEMORY 都声明
// 「开摊费/存取计息/投保/订单匹配随 M-B1 影子窗冻结」，但 `act stall` 没有任何闸 ——
// 节日当天任何玩家/Agent 都能真扣金币（ws.ts act stall），实现与声明相反。
// 冻结期存在的意义：M-B1（影子 14 真实日门）判门前不改经济结算面，避免观察窗数据失真。
//
// 闸的语义：缺省 = 冻结（与文档声明一致）；运营在 M-B1 判门通过后显式开：
//   AF_ECON_HOOKS=stall,interest        解冻指定钩子
//   AF_ECON_HOOKS=*                     全部解冻
// 纯函数（读 env），确定性，不触碰 events -> 不影响回放哈希。
export const ECONOMY_HOOKS = ['stall', 'interest', 'insurance', 'matching'] as const;
export type EconomyHook = (typeof ECONOMY_HOOKS)[number];

export function economyHooksRaw(env: Record<string, string | undefined> = process.env): string[] {
  return (env.AF_ECON_HOOKS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** 某钩子当前是否解冻；缺省（未配 AF_ECON_HOOKS）= 冻结 */
export function economyHookEnabled(hook: EconomyHook, env: Record<string, string | undefined> = process.env): boolean {
  const raw = economyHooksRaw(env);
  if (!raw.length) return false;
  return raw.includes('*') || raw.includes(hook);
}

/** 冻结时给玩家/Agent 的统一话术（文案即契约：报错必须说清怎么解冻） */
export function economyHookFrozenMsg(hook: EconomyHook, label: string): string {
  return `${label}随经济钩子冻结中（M-B1 影子观察窗判门前不开设）：运营开 AF_ECON_HOOKS 后生效`;
}

/** 全部钩子状态快照（挂 /af/economy 供观测） */
export function economyHookStatus(env: Record<string, string | undefined> = process.env): Record<EconomyHook, boolean> {
  const out = {} as Record<EconomyHook, boolean>;
  for (const h of ECONOMY_HOOKS) out[h] = economyHookEnabled(h, env);
  return out;
}