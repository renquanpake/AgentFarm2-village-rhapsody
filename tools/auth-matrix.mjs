// tools/auth-matrix.mjs —— D18 路由鉴权矩阵（路径 × token × uid 归属）
//
// 用途：把 server/src/gateway/http.ts 的 /af 路由逐条过一遍，产出鉴权矩阵文档，
// 并把「既无 token 校验、又不在公开白名单」的路由判死 —— 上线前必须逐条知情。
// 用法：node tools/auth-matrix.mjs [--write] [--check]
//   --write  写 docs/鉴权矩阵.md（矩阵与代码同源，改路由必须重跑）
//   --check  只判定（CI 用），文档缺失或过期即判死
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(repo, 'server/src/gateway/http.ts');
const DOC = path.join(repo, 'docs/鉴权矩阵.md');
const lines = fs.readFileSync(SRC, 'utf8').split('\n');

// 公开白名单：设计上必须无 token（登录前通道 / T1 文本无障碍面 / 静态资产）
const PUBLIC = {
  '/af/register': '登录前：注册（AF_REGISTER_INVITE + AF_MAX_PLAYERS 锁房门）',
  '/af/login': '登录前：换 token',
  '/af/join-room': '登录前：房间码换服务器地址',
  '/af/room': '登录前：登录屏显示穿透地址；roomCode 仅带 token 时返回',
  '/af/mapdoc': 'T2 文本地图（LLM 纯文本大脑的公共知识，刻意公开）',
  '/af/notices': 'T1 公告文本面',
  '/af/calendar': 'T1 历法/天气文本面',
  '/af/animals': 'T1 畜牧文本面',
  '/af/npc-schedule': 'T1 NPC 日程文本面',
  '/af/art-manifest': 'CC0/生图资产清单（公开只读）',
  '/af/art/{id}': '资产 PNG（公开只读）',
  '/af/mapgrid': '小地图网格/道路/地标（客户端渲染数据源，刻意公开）',
  '/af/tutorial': 'P4 新手教程 7 步文案（公开只读；带 token 时附该玩家进度）',
};

function routes() {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = /^\s*if \(u\.pathname === '(\/[^']+)'/.exec(l);
    if (m) {
      // register/login 共用一个分支：把同行的其它路径一并登记
      const paths = [...l.matchAll(/u\.pathname === '(\/[^']+)'/g)].map(x => x[1]);
      out.push({ kind: 'exact', paths, start: i });
      continue;
    }
    m = /^\s*const (\w+) = u\.pathname\.match\(/.exec(l);
    if (m) out.push({ kind: 'regex', varName: m[1], start: i, raw: l.trim() });
  }
  // 每条路由的块 = 起点到下一条路由起点（或文件尾）
  for (let k = 0; k < out.length; k++) {
    const end = k + 1 < out.length ? out[k + 1].start : lines.length;
    out[k].body = lines.slice(out[k].start, end).join('\n');
  }
  return out;
}

const rs = routes();
const rows = [];
const seenPath = new Set();
for (const r of rs) {
  const token = /findAccountByToken\(/.test(r.body);
  // /admin 家族：鉴权在块的序言里（adminOk），路由自身不再重复校验
  const adminAuth = r.start > 0 && /^\s*if \(!adminOk\(\)\)/.test(lines.slice(Math.max(0, r.start - 40), r.start + 1).join('\n').trim().split('\n').pop() || '')
    || lines.slice(Math.max(0, r.start - 40), r.start).some(l => /if \(!adminOk\(\)\)/.test(l));
  const uidOwn = /a\.uid !== |uid !== a\.uid|\.uid !== uid/.test(r.body);
  const method = /req\.method === '(GET|POST)'/.exec(r.body)?.[1] || 'ANY';
  const paths = r.kind === 'exact'
    ? r.paths
    : [`${r.raw.replace(/^\w+ = /, '').replace(/;$/, '')}`];
  const names = r.kind === 'exact' ? r.paths : paths;
  for (const p of names) {
    // 嵌套同路径分支（如 register/login 共享块内再判 register）只登记一次，取外层块
    if (seenPath.has(p)) continue;
    seenPath.add(p);
    const label = p.startsWith('/af/') && /\(\\d/.test(p) ? p : p;
    rows.push({
      path: label,
      method,
      token: token || adminAuth,
      adminAuth,
      uidOwn,
      public: !!PUBLIC[label],
      line: r.start + 1,
      note: PUBLIC[label] || (adminAuth ? 'AF_ADMIN_TOKEN 口令' : ''),
    });
  }
}

const bad = rows.filter(r => !r.token && !r.public);

const doc = [
  '# /af 路由鉴权矩阵（D18）',
  '',
  '> 由 `node tools/auth-matrix.mjs --write` 从 `server/src/gateway/http.ts` 生成，改路由必须重跑。',
  '> CI 门12 判定：既无 token 校验又不在公开白名单的路由 = 判死。',
  '',
  '口径：`token` = 路由内调用 `findAccountByToken`；`uid 归属` = 额外校验 token 主体 uid 与请求 uid 一致；',
  '`公开` = 登录前通道或 T1 文本无障碍面（设计如此，须在白名单登记理由）。',
  '',
  '| 路径 | 方法 | token | uid 归属 | 分类 | 说明 |',
  '|---|---|---|---|---|---|',
  ...rows.map(r => `| \`${r.path}\` | ${r.method} | ${r.token ? '✅' : '—'} | ${r.uidOwn ? '✅' : '—'} | ${r.public ? '公开' : (r.token ? '带 token' : '**未授权**')} | ${r.note || ''} |`),
  '',
  `合计 ${rows.length} 条：公开 ${rows.filter(r => r.public).length}、带 token ${rows.filter(r => r.token).length}、未授权 ${bad.length}。`,
  '',
  '## 遗留口径（有意为之，非缺陷）',
  '',
  '- `/af/saves/rename`、`/af/switch-slot`：校验 token 但不校验 uid 归属 —— 存档位是房间级共享资源（单房版设计），任何有效成员都可改名/切档。',
  '- `/af/dev/give-coins`、`/af/dev/give-item`：调试口子，作用域固定为 token 主体自己的 uid；上线前应加 `AF_DEV_ENDPOINTS=0` 关闭（当前仍开放，见 D18 附项）。',
  '- uid 归属校验目前只有 1 处（`/af/letter` 收信目标类参数）：多数端点由 token 反推 uid，请求体内不接受 uid，天然无越权面。',
  '',
].join('\n');

if (process.argv.includes('--write')) {
  fs.writeFileSync(DOC, doc);
  console.log(`[auth-matrix] 已写 ${path.relative(repo, DOC)}（${rows.length} 条路由）`);
}

const staleDoc = !fs.existsSync(DOC) || fs.readFileSync(DOC, 'utf8').trim() !== doc.trim();
console.log(`[auth-matrix] 路由 ${rows.length} 条：公开 ${rows.filter(r => r.public).length} / 带 token ${rows.filter(r => r.token).length} / 未授权 ${bad.length}`);
for (const r of bad) console.error(`FAIL 未授权路由 ${r.method} ${r.path}（http.ts:${r.line}）：既无 token 校验也不在公开白名单`);
if (staleDoc) console.log(`[auth-matrix] 注意：${path.relative(repo, DOC)} 与代码不同步（重跑 --write）`);
if (bad.length) { console.error(`\n[auth-matrix] ${bad.length} 条未授权路由 -> 上线前必须补 token 校验或登记公开白名单`); process.exit(1); }
if (process.argv.includes('--check') && staleDoc) { console.error('[auth-matrix] 文档过期 -> 跑 node tools/auth-matrix.mjs --write'); process.exit(1); }
console.log('[auth-matrix] PASS 全部路由均带 token 或在公开白名单内');