// _agnes-deco.mjs —— 让 Agnes 判断装饰贴图里哪些像栅栏/木桩
import { readFileSync } from 'node:fs';
const KEY = 'sk-vWFx8Ifrpvn4Zqe48FiUSKstxwdEu2yFo6hktUjzHRoGPaJa';
const b64 = readFileSync('D:/agent社区/AgentFarm2/_deco_sheet.png').toString('base64');
const prompt = '这是一张像素风游戏《乡村狂想曲》的素材贴图拼版，从左到右 6 张：mulan, mulan2, mulan3, mulan4, cdui(200x300), cdui2(100x200)。每张图是一格装饰（花/草/栅栏/木桩/草垛之类），每张图里从上到下可能有多个元素。请逐个贴图回答：它看起来像什么？特别注意：哪些贴图看起来像栅栏、木桩、柱子这类立起来的杆状物？简短回答即可。';
const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
  body: JSON.stringify({
    model: 'agnes-2.0-flash',
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
    ] }],
    max_tokens: 800, temperature: 0.2,
  }),
});
const j = await r.json();
console.log(j.choices?.[0]?.message?.content?.trim() || JSON.stringify(j).slice(0, 300));
