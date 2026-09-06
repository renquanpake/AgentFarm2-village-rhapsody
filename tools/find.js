// find.js <regex> [maxMatches] [contextChars]
const fs=require("fs");
const {s,mods}=require("./_lib.js");
const reStr=process.argv[2];
const max=parseInt(process.argv[3]||"30",10);
const ctx=parseInt(process.argv[4]||"180",10);
const re=new RegExp(reStr,"g");
// module ranges sorted by offset
const order=mods.slice().sort((a,b)=>a.off-b.off);
function owner(off){
  let last=null;
  for(const m of order){ if(m.off<=off) last=m; else break; }
  return last?last.name:"<BEFORE-FIRST>";
}
let m,found=[];
while((m=re.exec(s))!==null){
  found.push(m);
  if(found.length>=max) break;
}
console.log("matches:",found.length);
found.forEach((mm,mmIdx)=>{
  let o=mm.index;
  let text=mm[0].length>0?mm[0]:"";
  let cnt=text.slice(0,300);
  let snip=s.substring(Math.max(0,o-ctx),o+ctx);
  console.log("\n--- match",mmIdx,"@",o,"mod=",owner(o),"---");
  console.log("CAPTURE:",JSON.stringify(cnt));
  console.log("SNIP:",JSON.stringify(snip));
});
