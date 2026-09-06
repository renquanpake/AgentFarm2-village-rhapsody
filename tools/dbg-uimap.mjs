// dbg-uimap.mjs —— 提取 UiMap / MapMoudle 模块源码，看地图 UI 的图像来源
import { readFileSync } from 'node:fs';
const s = readFileSync('D:/agent社区/AgentFarm2/client/assets/main/index.e6d95.js', 'utf8');
console.log('index len:', s.length);
function dumpModule(name, offset, len = 6000) {
  const seg = s.slice(offset, offset + len);
  console.log(`\n===== ${name} @${offset} =====`);
  console.log(seg.slice(0, len));
}
dumpModule('UiMap', 2074423, 4500);
