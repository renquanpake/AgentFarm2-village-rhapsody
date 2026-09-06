const s=require("../_lib.js").s;
const mods=require("../_lib.js").mods;
const i=s.indexOf('.prototype.getTalkParamByGroup=');
console.log('prototype def?',i);
const i2=s.indexOf('e.getTalkParamByGroup=');
console.log('static def?',i2);
const i3=Math.max(i,i2);
let last=null; mods.forEach(m=>{if(m.off<=i3)last=m;}); console.log('in module', last?last.name:'?');
if(i3>=0) console.log(JSON.stringify(s.substring(i3,i3+800)));
