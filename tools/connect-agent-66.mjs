import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const accounts = JSON.parse(readFileSync(root + '\\data\\accounts.json', 'utf8'));
const account = accounts['66'];
if (!account) throw new Error('账号 66 不存在');

const response = await fetch('http://127.0.0.1:8080/af/agent-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: account.token }),
});
const { agentToken } = await response.json();
if (!agentToken) throw new Error('无法生成 Agent 接入令牌');

const notes = root + '\\data\\agent-notes\\66';
mkdirSync(notes, { recursive: true });
const debugSource = readFileSync(root + '\\tools\\verify-remote5.mjs', 'utf8');
const llmKey = debugSource.match(/--llm-key',\s*'([^']+)'/)?.[1] || '';
const agent = spawn(process.execPath, [
  root + '\\tools\\game-agent.mjs', '--token', agentToken, '--mode', 'text', '--rounds', '40', '--notes', notes,
  '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', llmKey, '--llm-model', 'deepseek-v4-flash',
], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
agent.unref();

await new Promise(resolve => setTimeout(resolve, 2500));
writeFileSync(notes + '\\inbox.json', JSON.stringify([
  { from: '玩家', text: '去钓鱼', at: Date.now() },
], null, 1));
const status = await (await fetch('http://127.0.0.1:8080/af/agent-status?token=' + encodeURIComponent(account.token))).json();
console.log(JSON.stringify({ pid: agent.pid, online: status.online, nick: status.nick }));
