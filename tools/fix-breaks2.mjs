// fix-breaks2.mjs —— act case 的 do-while 块内：break; -> continue;
// do-while(false) 里 continue 跳到条件检查(false)退出块，语义等同原 break，且 send(result) 照常执行。
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'D:/agent社区/AgentFarm2/server/afserver.mjs';
let s = readFileSync(p, 'utf8');
const start = s.indexOf('do { // do-while(false)');
const end = s.indexOf('} while (false); // end do-while');
if (start < 0 || end < 0) { console.error('anchor not found', start, end); process.exit(1); }
const head = s.slice(0, start);
const body = s.slice(start, end);
const tail = s.slice(end);
// 块内所有独立 break; 与行内 ; break; 都换成 continue 语义
const body2 = body
  .split('\n')
  .map(line => {
    if (line.trim() === 'break;') return line.replace('break;', 'continue;');
    return line.replace(/;\s*break;\s*$/, '; continue;');
  })
  .join('\n');
writeFileSync(p, head + body2 + tail);
console.log('replaced break -> continue in act do-block');
