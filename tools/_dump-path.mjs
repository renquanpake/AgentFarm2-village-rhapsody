// 解密并打印 dadituPath 资源全文（客户端村地图寻路/碰撞数据）
import { readFileSync, writeFileSync } from 'node:fs';
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
const p = 'client/assets/resources/import/77/77c8151a-dcaf-465a-bf76-bcac4056754a.c063c.json';
const raw = JSON.parse(decryptBuf(readFileSync(p)).toString('utf8'));
writeFileSync('tools/_out-dadituPath.txt', JSON.stringify(raw, null, 1), 'utf8');
console.log('written tools/_out-dadituPath.txt');
// 提取 tmxXmlStr 段看结构
const s = JSON.stringify(raw);
const i = s.indexOf('"dadituPath"');
console.log(s.slice(Math.max(0, i - 200), i + 2000));
