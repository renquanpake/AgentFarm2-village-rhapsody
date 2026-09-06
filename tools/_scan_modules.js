const fs=require("fs");
const f="D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js";
const s=fs.readFileSync(f,"utf8");
// Split modules on the wrapper pattern: "modName":[function pattern impossible reliably. Use cc._RF.push markers instead.
// Find offsets of cc._RF.push to get module boundaries
function findAll(needle){
  const out=[];let i=0;while((i=s.indexOf(needle,i))!==-1){out.push(i);i+=needle.length;}return out;
}
const rf = findAll('_RF.push');
console.log("RF.push count:",rf.length);
// Dump each module name
const names=[];
rf.forEach((off,idx)=>{
  // cc._RF.push(t,"xxx","MODNAME")
  // find the 3rd arg string
  let j=off+'_RF.push'.length;
  // locate first double quote after
  let q=s.indexOf('"',j);
  let q2=s.indexOf('"',q+1);
  let q3=s.indexOf('"',q2+1);
  let mod=s.substring(q2+1,q3);
  names.push({off,name:mod});
});
fs.writeFileSync("D:\\agent社区\\AgentFarm2\\tools\\_module_offsets.json",JSON.stringify(names));
console.log("module count:",names.length);
const known=['game','gameui','gframe','scene','player','npc','StorageUtil','Gwords','ResDefine','GameRes','UiHelper','playerMoudle','PlayerMoudle','TimeNode','MainController','MissionControl','UiManager','Language'];
names.forEach(n=>{ if(known.some(k=>n.name.toLowerCase().includes(k))) console.log(n.off, n.name);});
