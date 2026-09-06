// 打印玩家 prefab (0bdb479f8) 与疑似村庄场景 prefab (01be82a14) 的关键结构
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
function dump(p, name) {
  const raw = JSON.parse(decryptBuf(readFileSync(p)).toString('utf8'));
  const s = JSON.stringify(raw);
  console.log('===== ' + name + ' =====');
  // 节点树：找 _name 与 position/scale
  const names = [...s.matchAll(/"_name":"([^"]+)"/g)].map(m => m[1]);
  console.log('节点名:', names.slice(0, 80).join(', '));
  // RigidBody 类型
  for (const m of s.matchAll(/\{"__type__":"cc\.RigidBody"[\s\S]{0,400}/g)) {
    const seg = m[0];
    const t = seg.match(/"type":(\d+)/);
    console.log('RigidBody type=', t ? t[1] : '?', '→', t ? (t[1] === 1 ? 'DYNAMIC' : t[1] === 2 ? 'STATIC' : t[1] === 3 ? 'KINEMATIC' : '?') : '');
  }
  // pnlTiledMap 节点位置/缩放
  for (const m of s.matchAll(/"pnlTiledMap"[\s\S]{0,900}/g)) {
    const seg = m[0];
    const pos = seg.match(/"position":\{\s*"x":([-\d.]+),\s*"y":([-\d.]+)/);
    const sc = seg.match(/"scale":\{\s*"x":([-\d.]+),\s*"y":([-\d.]+)/);
    console.log('pnlTiledMap:', pos ? `pos(${pos[1]},${pos[2]})` : 'pos?', sc ? `scale(${sc[1]},${sc[2]})` : 'scale?');
  }
  // TiledMap 组件与 tmxAsset
  for (const m of s.matchAll(/\{"__type__":"cc\.TiledMap"[\s\S]{0,700}/g)) console.log('TiledMap:', m[0].slice(0, 500));
}
dump('client/assets/resources/import/0b/0bdb4798f.4784e.json', 'player prefab');
dump('client/assets/resources/import/01/01be82a14.d38fd.json', 'village? scene prefab');
