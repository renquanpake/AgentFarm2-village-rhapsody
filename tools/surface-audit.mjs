// tools/surface-audit.mjs —— H6 表面审计门（R9 T6：新增玩家可见信息必须同步文本通道）
// 轻量静态审计：核对服务端"玩家可见信息面"的文本通道齐备，缺则判死。
// 用法：node tools/surface-audit.mjs
// 约定：玩家可见信息 = 会进画面/面板/对话的玩法信息；每类必须至少一个文本端点
//       （/af/* 公开 GET 或 observe 字段）承载。缺通道 -> 该面"视觉独占"，违反设计铁律。
import fs from 'node:fs';
import path from 'node:path';
const repo = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const httpSrc = fs.readFileSync(path.join(repo, 'server/src/gateway/http.ts'), 'utf8');
const obsSrc = fs.readFileSync(path.join(repo, 'server/src/cognition/observe.ts'), 'utf8');
const wsSrc = fs.readFileSync(path.join(repo, 'server/src/gateway/ws.ts'), 'utf8');

// 信息面 -> 要求的文本通道（任一命中即通过）
const surfaces = [
  { name: '全村地图', probe: () => httpSrc.includes("'/af/mapdoc'") },
  { name: '公告', probe: () => httpSrc.includes("'/af/notices'") && obsSrc.includes('notices') },
  { name: '任务清单（任务链）', probe: () => obsSrc.includes('chains') && wsSrc.includes('taskView') },
  { name: '新手引导（Agent 侧 10 环）', probe: () => obsSrc.includes('onboarding') && wsSrc.includes('onboardingView') },
  // P4：人类玩家 7 步教程（data/tutorial.json 驱动 + GET /af/tutorial 公开面 + 客户端步骤条）
  { name: '新手教程（玩家 7 步）', probe: () => httpSrc.includes("'/af/tutorial'") && httpSrc.includes('tutorialView') && wsSrc.includes('tutorialAct') && fs.existsSync(path.join(repo, 'data', 'tutorial.json')) },
  { name: '季节事件线', probe: () => obsSrc.includes('seasonEvents') || wsSrc.includes('seasonEventsView') },
  { name: '资源认领（抢占）', probe: () => wsSrc.includes("'claim'") && wsSrc.includes('tryClaim') },
  { name: '节日板（计分/摊位）', probe: () => obsSrc.includes('festival') },
  { name: '背包/金币', probe: () => obsSrc.includes('coins') && obsSrc.includes('backpack') },
  { name: '位置', probe: () => obsSrc.includes('pos:') },
  { name: '建筑', probe: () => obsSrc.includes('buildings') },
  { name: '障碍', probe: () => obsSrc.includes('obstacles') },
  { name: '社交/好友', probe: () => obsSrc.includes('social') && wsSrc.includes('socialGive') },
  { name: '聊天/收件箱', probe: () => obsSrc.includes('inbox') },
  { name: '经济总账（设计值）', probe: () => httpSrc.includes("'/af/economy-design'") },
  { name: '里程碑度量（留存漏斗）', probe: () => httpSrc.includes("'/af/metrics'") },
];

let fails = 0;
for (const s of surfaces) {
  const ok = s.probe();
  console.log(`${ok ? 'PASS' : 'FAIL'} ${s.name}`);
  if (!ok) fails++;
}
if (fails) {
  console.error(`\n[surface-audit] ${fails} 个玩家可见信息面缺文本通道 -> 违反 R9 T1/T6 设计铁律`);
  process.exit(1);
}
console.log('\n[surface-audit] 全部玩家可见信息面均有文本通道（表面审计通过）');
