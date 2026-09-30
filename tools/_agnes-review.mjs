import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// _agnes-review.mjs —— 用 Agnes 视觉模型逐张审查截图（含重试）
import { readFileSync } from 'node:fs';
const KEY = process.env.AGNES_API_KEY;
const URL = 'https://apihub.agnes-ai.com/v1/chat/completions';
const DIR = 'D:/agent社区/AgentFarm2/';
const targets = process.argv.slice(2).map(t => t.startsWith('_') ? { name: t, file: t } : { name: t, file: '_v3_' + t + '.jpg' });
if (!targets.length) throw new Error('usage: node _agnes-review.mjs <name1> <name2> ...');
const PROMPT = `这是一张像素风种田游戏《乡村狂想曲》联机版的地图游戏截图（村庄+草地+道路，角色可能在画面中央）。请以挑剔的美术审查员身份检查并回答：
1. 地面衔接：是否看到明显的颜色分界线、硬边、方块拼接感、大面积同色块、贴图重复感？
2. 道路：道路是否清晰可辨、连续、没有突然断头或半截消失？
3. 房屋与装饰：房屋贴图是否正常（没有悬空、半截、压在别的东西上）？花草装饰是否自然？
4. 风格一致性：整体是否像同一种美术风格（草地/沙地/石板路混搭是否协调）？
5. 其他明显视觉问题（遮挡、穿模、黑块、UI遮挡等）。
请逐项简短回答："没问题"或"有问题：<具体描述+方位>"，最后给总分(1-10)和一句话总评。`;
async function ask(b64) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'agnes-2.0-flash',
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ] }],
      max_tokens: 900,
      temperature: 0.2,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j.choices?.[0]?.message?.content?.trim() || '';
}
for (const t of targets) {
  const b64 = readFileSync(DIR + t.file).toString('base64');
  const t0 = Date.now();
  let out = '';
  for (let attempt = 1; attempt <= 3 && !out; attempt++) {
    try { out = await ask(b64); }
    catch (e) { console.log(`  (attempt ${attempt} err: ${e.message.slice(0, 120)})`); }
    if (!out && attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`\n===== ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)}s) =====`);
  console.log(out || '(empty response after 3 attempts)');
}
