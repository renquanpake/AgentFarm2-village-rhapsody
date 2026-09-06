// fix-breaks.mjs —— 删除 act case 块内所有独立的 break; 行（保留 case 终止 break）
// 背景：case 'act' 是 if/else if 链 + 末尾 send(result)；链内 break 会跳出外层 switch(msg.t)，
//       导致 send 永不执行（move_to/talk/plant 等全部无响应）。
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'D:/agent社区/AgentFarm2/server/afserver.mjs';
let s = readFileSync(p, 'utf8');
const start = s.indexOf("case 'act': {");
const end = s.indexOf("case 'ping':");
if (start < 0 || end < 0) { console.error('anchor not found'); process.exit(1); }
const head = s.slice(0, start);
const body = s.slice(start, end);
const tail = s.slice(end);
const body2 = body.split('\n').filter(line => line.trim() !== 'break;').join('\n');
writeFileSync(p, head + body2 + tail);
console.log('removed break lines inside act block');
