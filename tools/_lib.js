const fs=require("fs");
const f="D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js";
const s=fs.readFileSync(f,"utf8");
// Build module index: pattern "Name:[function(e,t,i){" ... cc._RF.push(t,"hash","Name")
const mods=JSON.parse(fs.readFileSync("D:\\agent社区\\AgentFarm2\\tools\\_module_offsets.json","utf8"));
const idx={};
mods.forEach(m=>{ idx[m.name]=m.off; });
fs.writeFileSync("D:\\agent社区\\AgentFarm2\\tools\\_modidx.json",JSON.stringify(idx));
console.log("modidx built, names:",mods.length);
// helper usage:
/*
node _find.js "REGEX" [modNameFilter]
reports each match: byte offset + source line context
*/
module.exports={s,mods,idx};
