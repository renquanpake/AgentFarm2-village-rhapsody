const s=require("../_lib.js").s;
const mods=require("../_lib.js").mods;
const i=s.indexOf('.prototype.getTaskTalk=');
console.log('getTaskTalk prototype def at',i);
let last=null;
mods.forEach(m=>{if(m.off<=i)last=m;});
console.log('in module:', last?last.name:'?');
if(i>=0) console.log(JSON.stringify(s.substring(i-20,i+760)));
