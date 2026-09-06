// _agnes-screens.mjs —— Agnes 描述游戏截图画面
import { readFileSync } from 'node:fs';
const KEY = 'sk-vWFx8Ifrpvn4Zqe48FiUSKstxwdEu2yFo6hktUjzHRoGPaJa';
const prompt = '这是像素风种田游戏的浏览器截图。请客观描述画面：1) 整体是什么界面（主菜单/加载中/村庄游戏画面/弹窗/黑屏）？2) 画面上有什么（文字、按钮、角色、地图）？3) 如果能看到地图或村庄，描述地面和建筑。简短回答。';
for (const f of process.argv.slice(2)) {
  try {
    const b64 = readFileSync('D:/agent社区/AgentFarm2/' + f).toString('base64');
    const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: 'agnes-2.0-flash', messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
      ] }], max_tokens: 500, temperature: 0.2 }),
    });
    const j = await r.json();
    console.log('==== ' + f + ' ====');
    console.log(j.choices?.[0]?.message?.content?.trim() || '(empty)');
  } catch (e) { console.log(f, 'ERR', e.message.slice(0, 120)); }
}
