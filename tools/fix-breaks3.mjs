// fix-breaks3.mjs —— act do-while 块内：`; break; }` -> `; continue; }`（for 循环内的 break 除外）
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'D:/agent社区/AgentFarm2/server/afserver.mjs';
let s = readFileSync(p, 'utf8');
const start = s.indexOf('do { // do-while(false)');
const end = s.indexOf('} while (false); // end do-while');
if (start < 0 || end < 0) { console.error('anchor not found'); process.exit(1); }
const head = s.slice(0, start);
let body = s.slice(start, end);
const tail = s.slice(end);
// 先把 for 内 break 保护起来（换成占位）
body = body.replace('{ nearWater = true; break; }', '{ nearWater = true; __FOR_BREAK__; }');
// 行内 `; break; }` 与独立 `break;` 全换成 continue 语义
body = body.replace(/;\s*break;\s*}/g, '; continue; }');
body = body.replace(/^\s*break;\s*$/gm, 'continue;');
// 恢复 for 内 break
body = body.replace('{ nearWater = true; __FOR_BREAK__; }', '{ nearWater = true; break; }');
writeFileSync(p, head + body + tail);
console.log('done');
