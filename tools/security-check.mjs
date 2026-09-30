#!/usr/bin/env node
// tools/security-check.mjs —— 提交前安全审查（用户指令：每次 commit 前强制执行，PASS 才可提交）
// 用法：
//   node tools/security-check.mjs            扫描暂存区（git diff --cached，提交流程标准用法）
//   node tools/security-check.mjs --all      扫描工作区全部跟踪文件
// 检查项：
//   1. 敏感文件禁止入库：.env/.env.local/*.pem/*.key/id_rsa*/credentials*/*.p12/secrets.*
//   2. 机密内容扫描（内置规则，与 CI gitleaks 门同源互补）：
//      sk- 密钥 / GitHub PAT / GitLab PAT / AWS AKIA / Slack token / 私钥块 / password/api_key 赋值长串
//   3. 占位符豁免：your-key、example、placeholder、changeme、xxx、<...>、${...} 视为非机密
// 输出违规清单（片段脱敏），exit 1 = 存在风险，禁止提交。
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ALL = process.argv.includes('--all');

const SENSITIVE_FILE_RE = /(^|\/)(\.env(\.local)?|id_rsa[^/]*|credentials[^/]*|secrets?\.[^/]*|[^/]*\.(pem|key|p12|pfx))$/i;

const SECRET_RULES = [
  { name: 'sk-style-api-key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'github-pat', re: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { name: 'gitlab-pat', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: 'credential-assignment',
    re: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']([A-Za-z0-9+/_-]{16,})["']/gi,
    group: 1,
  },
];

const PLACEHOLDER_RE = /your[-_]?key|example|placeholder|changeme|xxx|<[^>]*>|\$\{|\btest\b|\bfake\b|\bdummy\b|\bsample\b/i;

function listFiles() {
  if (ALL) return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const out = execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!out.length) console.error('[security] 暂存区为空（先 git add，或用 --all 扫工作区）');
  return out;
}

function mask(s) {
  return s.length <= 8 ? '***' : s.slice(0, 4) + '***' + s.slice(-2);
}

const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|ico|bmp|tga|zip|gz|tar|br|woff2?|ttf|otf|eot|mp3|ogg|wav|m4a|bin|exe|dll|wasm|db|sqlite|tmx|plist|mp4|webm|pdf)$/i;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

let files = listFiles();
let violations = 0;

for (const rel of files) {
  const abs = join(ROOT, rel);
  if (SENSITIVE_FILE_RE.test(rel)) {
    console.error(`[security] FAIL 敏感文件入库: ${rel}`);
    violations++;
    continue;
  }
  if (BINARY_EXT_RE.test(rel)) continue;
  let text;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_SCAN_BYTES) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 4096).includes(0)) continue;
    text = buf.toString('utf8');
  } catch { continue; }
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (line.length > 2000 || PLACEHOLDER_RE.test(line)) continue;
    for (const rule of SECRET_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        const secret = rule.group ? m[rule.group] : m[0];
        if (PLACEHOLDER_RE.test(secret)) continue;
        console.error(`[security] FAIL ${rule.name} @ ${rel}:${i + 1} -> ${mask(secret)}`);
        violations++;
      }
    }
  }
}

// 附件确认：本地真实凭据载体必须保持 gitignored
try {
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  for (const f of ['.env', '.env.local']) {
    if (!ignore.split('\n').some(l => l.trim() === f || l.trim() === `${f.slice(0, 4)}*` || l.trim() === '.env*')) {
      console.error(`[security] WARN ${f} 未见 .gitignore 覆盖（请确认不入库策略）`);
    }
  }
} catch {}

if (violations > 0) {
  console.error(`[security] 总结：${violations} 项风险 —— 禁止提交，请先移除密钥/敏感文件`);
  process.exit(1);
}
console.error('[security] PASS：未发现机密泄漏与敏感文件，允许提交');
