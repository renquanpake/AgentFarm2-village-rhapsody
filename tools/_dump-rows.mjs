// 打印指定数据行的完整原始内容（village scene prefab 的碰撞体）
import { readFileSync } from 'node:fs';
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decryptBuf(buf) {
  if (buf.length < KEY.length) return buf;
  let signed = true;
  for (let i = 0; i < KEY.length; i++) if (buf[i] !== KEY[i]) { signed = false; break; }
  if (!signed) return buf;
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
const raw = JSON.parse(decryptBuf(readFileSync('client/assets/resources/import/01/01be82a14.d38fd.json')).toString('utf8'));
const [, , propNames, classDefs, dataRows] = raw;
const classes = classDefs.map(c => Array.isArray(c) ? { type: c[0], props: c.slice(1) } : { type: c, props: [] });
function show(rowIdx) {
  const row = dataRows[rowIdx];
  const cls = classes[row[0]] || { type: '?', props: [] };
  console.log(`\n[row${rowIdx}] ${cls.type}`);
  console.log('props:', JSON.stringify(cls.props));
  console.log('values:', JSON.stringify(row.slice(1)));
}
for (const i of [1, 4, 5, 7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 29, 30, 32]) show(i);
