import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// _agnes-strict.mjs —— 严格审美审查（逐项挑刺 + 定位）
import { readFileSync } from 'node:fs';
const KEY = process.env.AGNES_API_KEY;
const prompt = '这是像素风种田游戏《乡村狂想曲》联机版的村庄地图截图。请以最挑剔的专业美术审查员身份逐项严格检查，**宁可多报不可漏报**：\n1. 地面：是否有硬边分界线、色块拼接、大面积同色、贴图重复/网格感？\n2. 道路：是否连续可辨、有无断头、宽度是否自然、路与草地的过渡是否生硬？\n3. 建筑/装饰：房屋是否有悬空/压盖/比例问题？有无突兀的孤立物体（栅栏/木桩/杂物）？\n4. 水面：如有水，边缘是否自然？\n5. 场景氛围：整体是否像成熟游戏的地图？哪里有廉价感/半成品感？\n6. 其他任何视觉瑕疵。\n每项必须给出明确结论：没问题 或 有问题+具体方位描述。最后给出总分（满分10，7分以上才算及格）和一句总评。';
for (const f of process.argv.slice(2)) {
  let out = '';
  const b64 = readFileSync('D:/agent社区/AgentFarm2/_v3_' + f + '.jpg').toString('base64');
  for (let a = 1; a <= 3 && !out; a++) {
    try {
      const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
        body: JSON.stringify({ model: 'agnes-2.0-flash', messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
        ] }], max_tokens: 1200, temperature: 0.2 }),
      });
      const j = await r.json();
      out = j.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) { console.log('  (attempt', a, 'err:', e.message.slice(0, 100) + ')'); }
    if (!out && a < 3) await new Promise(r => setTimeout(r, 3000));
  }
  console.log('\n===== ' + f + ' =====');
  console.log(out || '(empty)');
}
