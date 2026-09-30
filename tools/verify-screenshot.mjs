import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// verify-screenshot.mjs —— CDP 截图两张对比，视觉验证 agent 是否在游戏画面中移动
import { connect } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // 1. 注入 55 登录
  const login = await (await fetch('http://127.0.0.1:8080/af/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '55', password: '1234' })
  })).json();
  if (!login.ok) { console.log('登录失败:', JSON.stringify(login)); process.exit(1); }
  console.log('登录成功:', login.uid);

  const cdp = await connect();
  await cdp.eval(`localStorage.setItem('af_token','${login.token}'); localStorage.setItem('af_uid','${login.uid}'); localStorage.setItem('af_nick','55');`);
  await cdp.eval('location.reload();');
  await wait(18000);

  // 2. 启动 agent
  const { spawn } = await import('node:child_process');
  const agent = spawn('node', [
    'D:/agent社区/AgentFarm2/tools/game-agent.mjs',
    '--token', '8e5179669c4c076ecb6ac3c7fc7fcfb3',
    '--mode', 'text', '--rounds', '30',
    '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/55',
    '--llm-url', 'https://api.deepseek.com/v1',
    '--llm-key', process.env.DEEPSEEK_API_KEY,
    '--llm-model', 'deepseek-v4-flash'
  ], { stdio: 'ignore' });
  console.log('agent pid:', agent.pid);

  // 3. 等 agent 行动
  await wait(20000);

  // 4. 截图 A
  const s1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('D:/agent社区/AgentFarm2/data/screenshots/snapA.png', Buffer.from(s1.data, 'base64'));
  const n1 = await cdp.eval(`(() => { const s=cc.director.getScene(); if(!s)return null; const c=s.getChildByName('Canvas'); const o=[]; c&&c.walk(n=>{if(n.name==='AFName')o.push({x:Math.round(n.parent.x),y:Math.round(n.parent.y),name:n.parent.name});}); return o[0]||null; })()`);
  console.log('截图A 节点:', JSON.stringify(n1.value));

  // 5. 再等 agent 移动
  await wait(15000);

  // 6. 截图 B
  const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('D:/agent社区/AgentFarm2/data/screenshots/snapB.png', Buffer.from(s2.data, 'base64'));
  const n2 = await cdp.eval(`(() => { const s=cc.director.getScene(); if(!s)return null; const c=s.getChildByName('Canvas'); const o=[]; c&&c.walk(n=>{if(n.name==='AFName')o.push({x:Math.round(n.parent.x),y:Math.round(n.parent.y),name:n.parent.name});}); return o[0]||null; })()`);
  console.log('截图B 节点:', JSON.stringify(n2.value));

  // 7. 像素对比
  const d1 = Buffer.from(s1.data, 'base64');
  const d2 = Buffer.from(s2.data, 'base64');
  let diff = 0, total = 0;
  for (let i = 0; i < Math.min(d1.length, d2.length); i += 500) { total++; if (d1[i] !== d2[i]) diff++; }
  const pct = (diff/total*100).toFixed(1);
  console.log('像素差异:', diff, '/', total, '采样 ('+pct+'%)');
  console.log('图片大小: A=' + d1.length + ' B=' + d2.length);

  if (diff > 10) console.log('✅ 截图有显著差异 → Agent 在游戏画面中移动了');
  else if (diff > 0) console.log('⚠️ 微小差异（可能只是时钟/动画）');
  else console.log('❌ 截图完全相同 → Agent 可能未移动');

  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
