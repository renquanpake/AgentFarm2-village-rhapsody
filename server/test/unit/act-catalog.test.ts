// test/unit/act-catalog.test.ts —— 批2 P3 Task1：act 动作语义表（单一事实源）
// 核心防漂移：从 ws.ts 源码正则提取 act 分支名，要求每个分支都有 catalog 条目（加动作忘进表 → 判红）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACT_CATALOG, ACT_NAMES, DIRECT_MESSAGES, catalogText, catalogNotice } from '../../src/world/act-catalog.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WS_SRC = fs.readFileSync(path.join(ROOT, 'server/src/gateway/ws.ts'), 'utf8');

/** ws.ts 里真实存在的 act 分支名（唯一事实源是代码，不是手抄清单） */
function branchNamesInSource(): string[] {
  const out = new Set<string>();
  for (const m of WS_SRC.matchAll(/action === '([a-z_]+)'/g)) out.add(m[1]);
  return [...out].sort();
}

/** ws.ts 里真实存在的直发消息 case 名 */
function caseNamesInSource(): string[] {
  const out = new Set<string>();
  for (const m of WS_SRC.matchAll(/case '([a-z_]+)':/g)) out.add(m[1]);
  return [...out].sort();
}

describe('act-catalog：动作语义表', () => {
  it('条目数 ≥40（覆盖全部 act 分支）', () => {
    expect(ACT_CATALOG.length).toBeGreaterThanOrEqual(40);
  });

  it('ws.ts 每个 act 分支都有 catalog 条目（新增动作漏进表 → 判红）', () => {
    const branches = branchNamesInSource();
    expect(branches.length).toBeGreaterThanOrEqual(40);
    const missing = branches.filter((b) => !ACT_NAMES.includes(b));
    expect(missing).toEqual([]);
  });

  it('catalog 无死条目（每个条目在 ws.ts 都有对应分支）', () => {
    const branches = new Set(branchNamesInSource());
    const dead = ACT_CATALOG.filter((e) => !branches.has(e.act)).map((e) => e.act);
    expect(dead).toEqual([]);
  });

  it('直发消息表双向对齐 ws.ts case 分支', () => {
    const cases = new Set(caseNamesInSource());
    const dead = DIRECT_MESSAGES.filter((e) => !cases.has(e.act)).map((e) => e.act);
    expect(dead).toEqual([]);
    for (const e of DIRECT_MESSAGES) expect(cases.has(e.act), `ws.ts 缺 case '${e.act}'`).toBe(true);
  });

  it('每个条目的 args 与 returns 非空，且 act 名唯一', () => {
    for (const e of [...ACT_CATALOG, ...DIRECT_MESSAGES]) {
      expect(e.act.length, `act 名空: ${JSON.stringify(e)}`).toBeGreaterThan(0);
      expect(e.args.trim().length, `${e.act} 缺 args`).toBeGreaterThan(0);
      expect(e.returns.trim().length, `${e.act} 缺 returns`).toBeGreaterThan(0);
    }
    const names = [...ACT_CATALOG, ...DIRECT_MESSAGES].map((e) => e.act);
    expect(new Set(names).size).toBe(names.length);
  });

  it('catalogText 覆盖四类代表动作（农业/社交/认领/休闲）', () => {
    const t = catalogText();
    for (const kw of ['chop', 'plant', 'bind', 'chat', 'claim', 'fish']) expect(t).toContain(kw);
  });

  it('catalogText 每条一行，行数与条目数一致', () => {
    const lines = catalogText().split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(ACT_CATALOG.length + DIRECT_MESSAGES.length);
    for (const e of [...ACT_CATALOG, ...DIRECT_MESSAGES]) {
      const line = lines.find((l) => l.startsWith(e.act));
      expect(line, `catalogText 缺 ${e.act} 行`).toBeTruthy();
      expect(line).toContain(e.args);
    }
  });

  it('catalogNotice 含全部动作名与导航/坐标说明（welcome 单一事实源）', () => {
    const n = catalogNotice();
    for (const e of [...ACT_CATALOG, ...DIRECT_MESSAGES]) expect(n, `welcome notice 缺动作 ${e.act}`).toContain(e.act);
    expect(n).toContain('observe');
    expect(n).toContain('move_to');
    expect(n).toContain('agent_arrive');
    expect(n).toContain('near');
    expect(n).toContain('格*100+50');
  });

  it('catalogNotice 长度受控（agent 首包体积）', () => {
    expect(catalogNotice().length).toBeLessThanOrEqual(4000);
  });
});