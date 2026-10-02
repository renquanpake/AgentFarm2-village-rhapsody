// world/gray-scale.ts —— 灰度开关（E 包）
// 单一总开关 AF_GRAYSCALE_ON=1 + 白名单 AF_GRAYSCALE_USERS（逗号分隔 uid 或 *）；
// 特性级开关 AF_FEATURE_OFF_<NAME>=1 可在灰度内单独关某特性。
// 纯函数：判定某 uid 某特性是否可用。确定性（同一输入同一输出，可回放）。

export interface GrayScaleConfig {
  on: boolean;
  users: string[]; // '*' = 全量白名单
  all: boolean;
}

/** 读 env 得灰度配置。缺省 = 灰度关（全量开放）。 */
export function grayScaleOf(env: Record<string, string | undefined> = process.env): GrayScaleConfig {
  const on = env.AF_GRAYSCALE_ON === '1' || env.AF_GRAYSCALE_ON === 'true';
  const raw = (env.AF_GRAYSCALE_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  const all = raw.includes('*') || (on && raw.length === 0);
  return { on, users: raw, all };
}

/** uid 某特性是否可用：灰度关=全开；灰度开=白名单（* 或命中）；特性级可单独关。 */
export function featureEnabled(g: GrayScaleConfig, uid: string, feature: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!g.on) return true; // 灰度关闭 = 全量开放
  if (g.all || g.users.includes(uid)) {
    const offFlag = env[`AF_FEATURE_OFF_${feature.toUpperCase()}`];
    return offFlag !== '1' && offFlag !== 'true';
  }
  return false;
}
