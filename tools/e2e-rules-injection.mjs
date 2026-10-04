// tools/e2e-rules-injection.mjs —— 批2 P3 Task4 端到端：规则提示词注入 NPC 对话链路
//
// 验的是「LLM 真的看到了权威规则」，不是「服务端拼出了字符串」：
//   1) 起一个假 OpenAI 兼容端点（8099），把收到的 system 里的【价目】段与反幻觉尾句回声
//   2) 把隔离实例的 provider 指向它，agent 通道 act talk 问价
//   3) 断言回声含尾句 + 含价目真值，且 NPC 收购价 = round(基价 × 0.6)
//   4) 断言 result 带 rulesHash（归因可追到规则版本）
//
// 前置：
//   终端 A：node tools/fake-llm-echo.mjs                （假 LLM，回声 system 里的价目段）
//   终端 B：cd server && PORT=8087 AF_SLOT=91 AF_NO_TUNNEL=1 AF_NO_GIT=1 node src/index.ts
// 用法：AF_BASE=http://127.0.0.1:8087 AF_FAKE_LLM=http://127.0.0.1:8099 node tools/e2e-rules-injection.mjs
const BASE = process.env.AF_BASE || 'http://127.0.0.1:8087';
const WS = BASE.replace(/^http/, 'ws');
const FAKE_LLM = process.env.AF_FAKE_LLM || 'http://127.0.0.1:8099';
const NPC_ID = Number(process.env.AF_NPC_ID || 4); // 屠夫：卖 12/10/19
const results = [];
const check = (name, cond, extra = '') => {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`);
};

const uname = `ruleinj_${Date.now() % 1e6}`;
const reg = await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'pass1234' }) }).then(r => r.json());
check('注册账号', reg.ok && reg.uid, reg.uid || JSON.stringify(reg));
const { token } = reg;

const cfg = await fetch(`${BASE}/af/agent-provider?token=${encodeURIComponent(token)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: FAKE_LLM, model: 'fake-model', key: 'fake-key' }),
}).then(r => r.json());
check('provider 指向假 LLM', cfg.ok === true, cfg.msg || '');

const atk = await fetch(`${BASE}/af/agent-token?token=${encodeURIComponent(token)}`, { method: 'POST' }).then(r => r.json());
const { default: WebSocket } = await import('ws');
const A = new WebSocket(`${WS}/agent?token=${encodeURIComponent(atk.agentToken)}`);
const seen = [];
A.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.t !== 'welcome' && m.t !== 'state') seen.push(m);
});
await new Promise(r => A.once('open', r));
await new Promise(r => setTimeout(r, 1500));

A.send(JSON.stringify({ t: 'act', action: 'talk', npcId: NPC_ID, text: '你这收多少？', seq: 1 }));
// LLM 往返 + 缓存路由，最长等 25s
const t0 = Date.now();
let llmResult = null;
while (Date.now() - t0 < 25_000 && !llmResult) {
  await new Promise(r => setTimeout(r, 500));
  llmResult = [...seen].reverse().find(m => m.t === 'result' && m.seq === 1 && String(m.dialogue || '').startsWith('ECHO')) || null;
}
const sync = seen.find(m => m.t === 'result' && m.seq === 1);
check('talk 同步价目表已下发（不依赖 LLM）', Array.isArray(sync?.priceList) && sync.priceList.length > 0, (sync?.priceList || []).join(' / '));
check('LLM 链路回话到达（system 被假 LLM 收到并回声）', !!llmResult, llmResult?.dialogue?.slice(0, 40) || 'timeout');
check('system 含反幻觉尾句', !!llmResult?.dialogue?.includes('HAS-TAIL'));
check('talk result 带 rulesHash（归因可追规则版本）', !!llmResult?.rulesHash, llmResult?.rulesHash || '(无)');

// 与 /af/prompts 的权威价目逐条核对（六折口径）
const rp = await fetch(`${BASE}/af/prompts?token=${encodeURIComponent(token)}&budget=full`).then(r => r.json());
const seg = (rp.text.match(/【价目】[\s\S]*?(?=\n【)/) || [''])[0];
const rows = [...seg.matchAll(/(\d+)=(\S+?)（市场基价 (\d+)，NPC 收购 (\d+)）/g)];
check('权威价目段可解析出条目', rows.length > 0, `${rows.length} 条`);
const sixFoldOk = rows.length > 0 && rows.every(([, , , base, buy]) => Number(buy) === Math.max(1, Math.round(Number(base) * 0.6)));
check('NPC 收购价 = round(基价 × 0.6) 逐条成立', sixFoldOk, rows.slice(0, 3).map(r => `${r[2]}:${r[3]}→${r[4]}`).join(' '));
const echo = llmResult?.dialogue || '';
const inEcho = rows.filter(r => echo.includes(r[4]));
check('价目真值出现在 LLM 收到的 system 里', inEcho.length > 0, `${inEcho.length}/${rows.length} 条被回声`);

console.log(`----\n结果: ${results.filter(Boolean).length}/${results.length} 通过`);
process.exit(results.every(Boolean) ? 0 : 1);