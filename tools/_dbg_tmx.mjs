import { readFileSync } from 'node:fs';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const buf = readFileSync('D:/agent社区/AgentFarm2/client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const out = Buffer.allocUnsafe(buf.length - KEY.length);
for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
const raw = JSON.parse(out.toString('utf8'));
const rawStr = JSON.stringify(raw);
const tmxKey = '"tmxXmlStr"';
const ti = rawStr.indexOf(tmxKey);
console.log('ti:', ti);
console.log('ctx:', JSON.stringify(rawStr.slice(ti, ti + 60)));
let i = ti + tmxKey.length;
while (i < rawStr.length && rawStr[i] !== '"') i++;
console.log('valStart:', i, JSON.stringify(rawStr.slice(i, i + 40)));
let j = i + 1, steps = 0, valEnd = -1;
while (j < rawStr.length && steps < 500000) {
  const c = rawStr[j];
  if (c === '\\') { j += 2; steps++; continue; }
  if (c === '"') { valEnd = j; break; }
  j++; steps++;
}
console.log('valEnd:', valEnd, 'len:', valEnd - i + 1);
const val = rawStr.slice(i, valEnd + 1);
console.log('val head:', JSON.stringify(val.slice(0, 80)));
console.log('JSON.parse ok:', typeof JSON.parse(val) === 'string');
