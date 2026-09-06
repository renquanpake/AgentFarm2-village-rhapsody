// dbg-uimap2.mjs —— 找 village 节点 spriteFrame 的纹理 uuid
import { readFileSync } from 'node:fs';
const s = readFileSync('D:/agent社区/AgentFarm2/_decrypted/resources/import/05/05ce36bdb.5e75c.json', 'utf8');
const refs = [...s.matchAll(/"__uuid__":"([^"]+)"/g)].map(m => m[1]);
console.log('__uuid__ refs:', JSON.stringify(refs));
let idx = 0;
while ((idx = s.indexOf('f1mHkLwTpAC6zQeumeUfMv', idx)) >= 0) {
  console.log('\n@' + idx + ': ' + s.slice(Math.max(0, idx - 90), idx + 140));
  idx += 10;
}
// 解析 deps 图：找 Sprite 组件对象（含 _spriteFrame）
const raw = JSON.parse(s);
const deps = raw[5];
console.log('\ndeps keys:', JSON.stringify(deps).slice(0, 600));
