const s=require("../_lib.js").s;
const of=1321762, head=s.lastIndexOf('[function',of);
const pop=s.indexOf('cc._RF.pop()',of);
const b=s.substring(head-4,pop);
// list all Gwords_ import var assignments
const mods=require("../_lib.js").mods;
console.log('=== Gwords modules merged into _gWord ===');
[...b.matchAll(/config\/(Gwords_[A-Za-z0-9_]+)\"/g)].forEach(m=>{ if(!m[1].includes('_config')) console.log(m[1]); });
