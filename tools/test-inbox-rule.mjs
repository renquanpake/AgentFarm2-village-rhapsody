import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// test-inbox-rule.mjs —— 验证收件箱规则执行（LLM 失败也不影响）
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const wait = ms => new Promise(r => setTimeout(r, ms));
writeFileSync('D:/agent社区/AgentFarm2/data/agent-notes/test3/inbox.json', JSON.stringify([{ from: 'test3', text: '去村中心', at: Date.now() }], null, 1));
console.log('收件箱: 去村中心');
const child = spawn('node', [
  'D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', 'f70039c9b0729fae6c448b127862685e',
  '--mode', 'text', '--rounds', '3', '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
  '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', process.env.DEEPSEEK_API_KEY, '--llm-model', 'deepseek-v4-flash'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => { out += d.toString(); process.stdout.write(d); });
child.stderr.on('data', d => { out += d.toString(); process.stderr.write(d); });
child.on('close', () => {
  const hasRule = out.includes('[规则]') || out.includes('move_to 结果');
  console.log(hasRule ? '\n✅ 收件箱规则执行生效（move_to 已执行）' : '\n⚠️ 未见规则执行（可能 LLM 正常接手或收件箱未读取）');
  process.exit(0);
});
