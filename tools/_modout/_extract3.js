const fs=require("fs");
const s=require("../_lib.js").s;
const mods=require("../_lib.js").mods;
const want=process.argv.slice(2);
// module-by-offset: find module whose name matches or whose name==want via header search; cap by next offset from mods list
function findByName(name){
  const key=name+":[function(e,t,i){";
  return s.indexOf(key);
}
want.forEach(name=>{
  let off=findByName(name);
  if(off<0){console.log("NOT FOUND",name);return;}
  // find the enclosing module in mods list nearest after off
  let nxt=Infinity;
  for(const m of mods){ if(m.off>off && m.off<nxt){ nxt=m.off; } }
  let end = isFinite(nxt)? nxt : s.length;
  // but mods list may not contain the target; ensure end>off
  let block=s.substring(off,Math.min(end, s.length));
  // block will include trailing module separators; trim at number of leading module? keep raw, we parse locally
  fs.writeFileSync("D:\\agent社区\\AgentFarm2\\tools\\_modout\\full_"+name+".js",block);
  console.log("WROTE full_"+name+".js off="+off+" len="+block.length+" end="+end);
});
