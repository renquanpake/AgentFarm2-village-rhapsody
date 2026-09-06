// memory.ts —— Agent 记忆四件套（C4，kepano/obsidian-markdown 规范）：低频写盘
// memory/<agentId>/profile.md（身份/性格/礼物偏好，玩家可编辑）
// memory/<agentId>/diary.md    （每日总结，睡前写，追加历史）
// memory/<agentId>/plans.md    （今日计划，晨起写）
// memory/<agentId>/relations.md（好感/关系，变化时写）
import fs from 'node:fs';
import path from 'node:path';
import { MEMORY_DIR } from './config.ts';
import type { Actor } from './world.ts';
import { itemNames } from './config.ts';

export function memoryPath(a: Actor, file: string): string {
  const dir = path.join(MEMORY_DIR, a.id);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

/** 新角色初始化四件套（无则创建默认） */
export function ensureMemory(a: Actor) {
  try {
    const dir = path.join(MEMORY_DIR, a.id);
    fs.mkdirSync(dir, { recursive: true });
    const profile = path.join(dir, 'profile.md');
    if (!fs.existsSync(profile)) {
      fs.writeFileSync(profile, `# ${a.name} 的档案\n\n- 身份：${a.name}，AgentFarm 农场共居世界居民\n- 性格：勤劳、友善、有一点小幽默\n- 礼物偏好：喜欢食物和矿石（小麦、鱼、铜矿石）\n- 梦想：把家园建成自动化大农场\n\n> 玩家可以编辑这个文件来塑造 Agent 的性格。\n`);
    }
    for (const f of ['diary.md', 'plans.md', 'relations.md']) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) fs.writeFileSync(p, f === 'relations.md' ? `# ${a.name} 的关系\n\n(暂无)\n` : `# ${a.name} 的${f === 'diary.md' ? '日记' : '计划'}\n\n(暂无)\n`);
    }
  } catch { /* 记忆目录不可写时忽略 */ }
}

/** 睡前写日记（低频：当天摘要从行为统计生成，不调用 LLM 省钱） */
export function writeDiary(a: Actor, day: number) {
  try {
    const s = a.stats;
    const parts = [
      `今天（第 ${day} 天）结束了。`,
      `挖矿 ${s.useTool['58'] || 0} 次、砍树 ${s.useTool['4'] || 0} 次、锄地 ${s.useTool['2'] || 0} 次、播种 ${s.plant} 次、对话 ${s.talk} 次。`,
      `背包里有：${Object.entries(a.items).filter(([, v]) => v > 0).map(([k, v]) => `${itemNames[k] || k}×${v}`).join('、') || '空空如也'}。`,
      `金币 ${a.gold}，与 ${Object.keys(a.relations).length} 位伙伴有来往。`
    ];
    const entry = `## 第 ${day} 天\n\n${parts.join('\n')}\n\n`;
    fs.appendFileSync(memoryPath(a, 'diary.md'), entry);
  } catch { /* 忽略 */ }
}

/** 晨起写计划（模板：按当天任务推进） */
export function writePlans(a: Actor, day: number) {
  try {
    const plan = [
      `## 第 ${day} 天计划`,
      '',
      '1. 早上先检查作物：浇水、收获成熟的庄稼',
      '2. 饱食度低于 50 就去吃饭/钓鱼',
      '3. 下午干资源活：砍树或挖矿攒材料',
      '4. 傍晚和村民聊天，帮忙',
      '5. 天黑前回家睡觉',
      '',
      '> 依据：任务书 + 玩家指令优先'
    ].join('\n');
    fs.writeFileSync(memoryPath(a, 'plans.md'), `# ${a.name} 的计划\n\n${plan}\n`);
  } catch { /* 忽略 */ }
}

/** 关系变化时更新 relations.md（低频：调用方在好感变化/关系绑定/解除时触发） */
export function writeRelations(a: Actor) {
  try {
    const lines = Object.entries(a.relations)
      .sort((x, y) => y[1] - x[1])
      .map(([id, score]) => {
        const rel = a.relation[id] || '';
        return `- ${id}：好感 ${score}${rel ? `（${rel}）` : ''}`;
      });
    fs.writeFileSync(memoryPath(a, 'relations.md'), `# ${a.name} 的关系\n\n${lines.join('\n') || '(暂无)'}\n`);
  } catch { /* 忽略 */ }
}