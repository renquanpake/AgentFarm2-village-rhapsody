import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// 用 Agnes 描述小地图截图
import { readFileSync } from 'node:fs';
const KEY = process.env.AGNES_API_KEY;
const b64 = readFileSync('D:/agent社区/AgentFarm2/_dbg_littlemap.png').toString('base64');
const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
  body: JSON.stringify({ model: 'agnes-2.0-flash', messages: [{ role: 'user', content: [
    { type: 'text', text: '这是游戏截图。请描述屏幕中央/右侧的地图面板（如果有）：它是一个什么样子的小地图/大地图？里面画了什么（地图形状、颜色块、标记点）？有没有村庄地图的底图？请具体描述。"' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
  ] }], max_tokens: 800, temperature: 0.2 }),
});
const j = await r.json();
console.log(j.choices?.[0]?.message?.content || '(empty)');
