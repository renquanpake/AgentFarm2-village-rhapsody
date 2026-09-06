const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
function finds(needle){let o=[],i=0;while((i=s.indexOf(needle,i))!==-1){o.push(i);i+=needle.length;}return o;}
["ccclass(\"MainGame","ccclass(\"GameScene","MainGameScene","BootstrapScene","ccclass(\"GamePlatform"].forEach(n=>{
  const o=finds(n); console.log(n,"=>",o.slice(0,5));
});
// Find what module offset ~368286 (GameScene class) is in
const mods=JSON.parse(fs.readFileSync("D:\\agent社区\\AgentFarm2\\tools\\_module_offsets.json","utf8")).sort((a,b)=>a.off-b.off);
let last=null; for(const m of mods){ if(m.off<=368286) last=m; else break;}
console.log("owner of 368286:", last);
