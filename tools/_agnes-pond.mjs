import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// 描述水塘截图
import { readFileSync } from 'node:fs';
const KEY = process.env.AGNES_API_KEY;
const b64 = readFileSync('D:/agent社区/AgentFarm2/_dbg_pond.png').toString('base64');
const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
  body: JSON.stringify({ model: 'agnes-2.0-flash', messages: [{ role: 'user', content: [
    { type: 'text', text: '这是游戏截图，玩家站在村庄水塘旁。请描述：1) 画面里有没有水塘/水池？如果有，水的颜色、形状、边缘什么样？2) 水塘周围的地面是什么？3) 有没有看起来像水却被草地覆盖/被草遮挡的区域？请具体描述。"' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
  ] }], max_tokens: 700, temperature: 0.2 }),
});
const j = await r.json();
console.log(j.choices?.[0]?.message?.content || '(empty)');
