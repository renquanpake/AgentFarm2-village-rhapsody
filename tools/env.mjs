// tools/env.mjs —— 本地调试脚本凭据加载（.env + .env.local，gitignored；进程已有环境变量优先）
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadLocalEnv() {
  for (const name of ['.env', '.env.local']) {
    const p = join(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  // 缺失告警（脚本继续跑，调用方 401 可见）
  for (const v of ['AGNES_API_KEY', 'DEEPSEEK_API_KEY']) {
    if (!process.env[v]) console.warn('[env] 未找到 ' + v + '（.env.local 缺值？）——相关脚本将以无密钥状态运行');
  }
}
