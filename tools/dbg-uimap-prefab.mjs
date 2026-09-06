// dbg-uimap-prefab.mjs —— 解析 UiMap prefab，找 village 小地图节点与 spriteFrame
import { readFileSync } from 'node:fs';
const s = readFileSync('D:/agent社区/AgentFarm2/_decrypted/resources/import/05/05ce36bdb.5e75c.json', 'utf8');
const raw = JSON.parse(s);
// Cocos 压缩格式: [ver, uuids[], props[], types[], deps[], nodes[]]
const [ver, uuids, props, types, deps, nodes] = raw;
console.log('ver:', ver, 'uuids:', uuids.length, 'nodes:', nodes.length);
// 在原始字符串中找 village
let idx = 0, cnt = 0;
while ((idx = s.indexOf('village', idx)) >= 0 && cnt < 8) {
  console.log('\nvillage @' + idx + ': ' + s.slice(Math.max(0, idx - 200), idx + 250));
  idx += 10; cnt++;
}
// 找节点名列表（nodes 里的 name 字段）
function walk(v, depth = 0, path = '') {
  if (Array.isArray(v)) {
    // 节点数组形式: [type, name, flags, comps, children, ...]
    if (v.length >= 2 && typeof v[1] === 'string' && typeof v[0] === 'number') {
      const p = path + '/' + v[1];
      if (['village', 'pnlContent', 'dadituMap', 'home', 'river'].includes(v[1])) console.log('NODE:', p);
    }
    for (const x of v) walk(x, depth + 1, path);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, depth + 1, path);
  }
}
walk(nodes);
