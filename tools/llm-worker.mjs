#!/usr/bin/env node
// tools/llm-worker.mjs —— 廉价执行模型委托 CLI（主 Agent 规划/验收，agnes flash 档执行）
// 用法：
//   node tools/llm-worker.mjs --in task.md --out result.md          文件进出
//   echo "任务描述" | node tools/llm-worker.mjs                      stdin 进 stdout 出
//   node tools/llm-worker.mjs --system "角色设定" --in task.md       附加系统提示
// 选项：--max-tokens N（默认 4096） --temperature F（默认 0.3，代码任务低温）
// Key 通道与项目托管 LLM 同源：AF_LLM_URL/AF_LLM_KEY/AF_LLM_MODEL（.env），缺省回落 USER_IMG_*，模型缺省 agnes-3.0-flash
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  for (const f of [`${__dirname}/../.env`, `${__dirname}/../.env.local`]) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {}
  }
}
loadLocalEnv();

const args = process.argv.slice(2);
const argOf = (k, dflt) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };
const has = (k) => args.includes(k);

const url = process.env.AF_LLM_URL || process.env.USER_IMG_BASE_URL || '';
const key = process.env.AF_LLM_KEY || process.env.USER_IMG_API_KEY || '';
const model = process.env.AF_LLM_MODEL || 'agnes-3.0-flash';
if (!url || !key) { console.error('[llm-worker] 缺 AF_LLM_URL/AF_LLM_KEY（或 USER_IMG_*）：请在 .env 配置'); process.exit(1); }

const inFile = argOf('--in', null);
const outFile = argOf('--out', null);
const system = argOf('--system', null);
const maxTokens = parseInt(argOf('--max-tokens', '4096'), 10);
const temperature = parseFloat(argOf('--temperature', '0.3'));

const userText = inFile ? readFileSync(inFile, 'utf8') : readFileSync(0, 'utf8');
if (!userText.trim()) { console.error('[llm-worker] 任务为空（--in 文件或 stdin）'); process.exit(1); }

const messages = [];
if (system) messages.push({ role: 'system', content: system });
messages.push({ role: 'user', content: userText });

async function call() {
  const res = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

let j;
try { j = await call(); }
catch (e) {
  console.error(`[llm-worker] 首次失败（${e.message}），5s 后重试一次`);
  await new Promise(r => setTimeout(r, 5000));
  try { j = await call(); } catch (e2) { console.error(`[llm-worker] 重试失败：${e2.message}`); process.exit(1); }
}

const text = j.choices?.[0]?.message?.content ?? '';
const u = j.usage || {};
console.error(`[llm-worker] model=${model} tokens in=${u.prompt_tokens ?? '?'} out=${u.completion_tokens ?? '?'} total=${u.total_tokens ?? '?'}`);
if (outFile) { mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, text); console.error(`[llm-worker] 已写出 ${outFile}`); }
else process.stdout.write(text);
