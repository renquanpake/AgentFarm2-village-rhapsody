const fs=require("fs");
const s=require("../_lib.js").s;
const want=process.argv.slice(2);
// find all module-style headers quickly: '"' name ':[' followed by 'function'
function nextModuleStart(from){
  const re=/,"[A-Za-z0-9_]+":\[function\(e,t,i\)\{/g;
  re.lastIndex=from;
  const m=re.exec(s);
  return m? m.index : s.length; // index of ',' before next module
}
want.forEach(name=>{
  const key=name+":[function(e,t,i){";
  const off=s.indexOf(key);
  if(off<0){console.log("NOT FOUND",name);return;}
  let pop=s.indexOf('cc._RF.pop()',off);
  let from = pop+13;
  let mine=nextModuleStart(from);
  let nodeStart=s.indexOf('[function',off);
  let block=s.substring(off, mine); // includes requires map of this module (up to next module's header)
  fs.writeFileSync("D:\\agent社区\\AgentFarm2\\tools\\_modout\\full_"+name+".js",block);
  console.log("WROTE full_"+name+".js off="+off+" len="+block.length+" nextAt="+mine);
});
