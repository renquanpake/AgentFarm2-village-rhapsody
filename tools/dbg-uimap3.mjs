// dbg-uimap3.mjs —— 解析 Cocos 压缩 prefab：village 节点 Sprite 组件的 spriteFrame 引用
import { readFileSync } from 'node:fs';
const p = 'D:/agent社区/AgentFarm2/_decrypted/resources/import/05/05ce36bdb.5e75c.json';
const raw = JSON.parse(readFileSync(p, 'utf8'));
const [ver, uuids, props, types, deps, nodes] = raw;
// uuids 表
console.log('uuids:', JSON.stringify(uuids));
// 属性表
console.log('props:', JSON.stringify(props).slice(0, 400));
// deps 图：找 village 节点的组件对象。节点数据里 [0,"f1mHkLwTpAC6zQeumeUfMv",1] 是压缩组件引用。
// Cocos 2.4 压缩格式中，组件 uuid 是 "编辑器uuid" -> 通过 uuids 表映射。
// 节点 [3,"village",512,8,-32,[0,"f1mHkLwTpAC6zQeumeUfMv",1],...] 中 [0,"uuid",1] = 组件列表（压缩）
// 组件实例对象在 deps 图里，用编辑器 uuid 关联。
const s = JSON.stringify(raw);
// 找 "f1mHkLwTpAC6zQeumeUfMv" 出现次数
const cnt = (s.match(/f1mHkLwTpAC6zQeumeUfMv/g) || []).length;
console.log('\nf1mHkLwTpAC6zQeumeUfMv occurrences:', cnt);
// 解析 deps 的对象图（含 __type__ 的对象）
const found = [];
function walk(v) {
  if (Array.isArray(v)) { for (const x of v) walk(x); }
  else if (v && typeof v === 'object') {
    if (v.__type__) found.push({ type: v.__type__, keys: Object.keys(v).filter(k => k !== '__type__') });
    for (const x of Object.values(v)) walk(x);
  }
}
walk(deps);
for (const f of found) if (f.type === 'cc.Sprite' || f.type === 'cc.SpriteFrame') console.log(JSON.stringify(f));
