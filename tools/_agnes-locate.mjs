import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// _agnes-locate.mjs —— 让 Agnes 精确报告白线的屏幕像素坐标
import { readFileSync } from 'node:fs';
const KEY = process.env.AGNES_API_KEY;
const b64 = readFileSync('D:/agent社区/AgentFarm2/_v3_west_door8.jpg').toString('base64');
const prompt = '这是 1440x900 的像素风游戏截图。画面中有一条"白色/亮色硬边分界线"（贯穿上下）。请精确定位它：1) 它位于屏幕水平方向的哪个 x 像素范围（0=最左，1440=最右）？2) 它是笔直的竖线还是有形状？3) 线的两侧各是什么颜色/内容？4) 除了这条线，画面里还有哪些明显的亮色（沙地/道路）区域，分别在什么 x 像素范围？请务必给出具体像素坐标，不要泛泛而谈。';
const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
  body: JSON.stringify({ model: 'agnes-2.0-flash', messages: [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
  ] }], max_tokens: 900, temperature: 0.2 }),
});
const j = await r.json();
console.log(j.choices?.[0]?.message?.content?.trim() || '(empty)');
