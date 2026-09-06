const s=require("../_lib.js").s;
const of=1321762,head=s.lastIndexOf('[function',of);
const pop=s.indexOf('cc._RF.pop()',of);
const b=s.substring(head-4,pop);
const idx=b.indexOf('i._gLang1=new');
console.log(JSON.stringify(b.substring(idx-120, idx+700)));
