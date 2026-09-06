const s=require("../_lib.js").s;
const mods=require("../_lib.js").mods;
function owner(of){let last=null;for(const m of mods){if(m.off<=of)last=m;else break;}return last?last.name:'none';}
console.log('owner of 1818427 (initNpcs):', owner(1818427));
console.log('owner of 1604775 (Npc.updateStayScene):', owner(1604775));
console.log('owner of 196605 (getTalkParamByGroup):', owner(196605));
// dump SceneBase module's initNpcs properly
let last=null; mods.forEach(m=>{if(m.off<=1818427)last=m;});
const off=last.off, name=last.name;
const b=s.substring(off, s.indexOf('cc._RF.pop()',off));
const st=b.indexOf('t.prototype.initNpcs=');
console.log('\n=== '+name+' initNpcs ===');
console.log(b.substring(st, st+900));
