// dbg-prefab.mjs —— 解密 prefab json，找 village 小地图节点与图片引用
import { readFileSync } from 'node:fs';
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
const p = 'D:/agent社区/AgentFarm2/_decrypted/resources/import/02/02dc66b29.516a8.json';
const raw = JSON.parse(readFileSync(p, 'utf8')); // _decrypted 是明文 Cocos 格式
const s = JSON.stringify(raw);
console.log('json len:', s.length);
const names = s.match(/"__type__":"([^"]+)"/g) || [];
console.log('types:', [...new Set(names)].slice(0, 15).join(', '));
let idx = 0, cnt = 0;
while ((idx = s.indexOf('village', idx)) >= 0 && cnt < 6) {
  console.log('\n@' + idx + ': ' + s.slice(Math.max(0, idx - 120), idx + 200));
  idx += 10; cnt++;
}
// 找 spriteFrame 引用（cc.SpriteFrame uuid 形如 aaaa-bbbb-...）
const sf = s.match(/"spriteFrame":\{"__uuid__":"([^"]+)"\}/g);
console.log('\nspriteFrame refs:', sf ? sf.slice(0, 8).join('\n') : 'none');
