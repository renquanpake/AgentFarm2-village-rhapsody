// 解码 Cocos 2.4 压缩 prefab：列出节点树、碰撞组件（含尺寸/位置）
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

const [,, pathArg, nameArg] = process.argv;
const raw = JSON.parse(decryptBuf(readFileSync(pathArg)).toString('utf8'));
console.log('===', nameArg || pathArg, '===');
// 结构: [version, uuids[], propNames[], classDefs[], dataRows[], ...]
const [, , propNames, classDefs, dataRows] = raw;
const classes = [];
for (const c of classDefs) {
  classes.push(Array.isArray(c) ? { type: c[0], props: c.slice(1) } : { type: c, props: [] });
}
function resolveVal(v) {
  if (typeof v === 'number') {
    if (v >= 0) return '?' + propNames[v];
    return '#ref' + v;
  }
  return JSON.stringify(v);
}
// 打印所有实例行（简化：类型名 + 属性）
for (let i = 0; i < dataRows.length; i++) {
  const row = dataRows[i];
  if (!Array.isArray(row) || !row.length) continue;
  const clsIdx = row[0];
  const cls = classes[clsIdx] || { type: '?', props: [] };
  const type = cls.type;
  if (!/Collider|RigidBody|Node$/.test(String(type))) continue;
  // 值 = row.slice(2) 对齐 cls.props
  const vals = row.slice(2);
  const kv = [];
  for (let p = 0; p < cls.props.length; p++) {
    const pn = String(cls.props[p]);
    const v = vals[p];
    if (v === undefined) break;
    if (pn === '_name' || pn === '_size' || pn === '_offset' || pn === 'type' || pn === '_position' || pn === '_scale' || pn === '_contentSize' || pn === '_groupIndex' || pn === 'size' || pn === 'offset' || pn === '_sensor' || pn === 'sensor' || pn === '_tag') {
      kv.push(pn + '=' + resolveVal(v));
    }
  }
  console.log(`[row${i}] ${type} ${kv.join(' ')}`);
}
// 节点树（root 引用）
const rootRow = dataRows[raw[3] && raw.length > 6 ? raw[6] : 0];
console.log('root row idx:', raw[3] !== undefined ? raw[3] : '?');
