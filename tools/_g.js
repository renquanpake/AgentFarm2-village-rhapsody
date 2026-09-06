const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
// GameRes starts ~1750876 (ResDefine). The block: i.GameRes=new function(){...};i.GamePath={...}
let startIdx=s.indexOf('i.GameRes=new function');
console.log("GameRes block starts at:", startIdx);
let gp=s.indexOf('i.GamePath=', startIdx);
let bundle=s.indexOf('i.BundleName=', startIdx);
console.log("GamePath at:", gp, " BundleName at:", bundle);
console.log("\n=== GamePath ===");
console.log(s.substring(gp, bundle+200));
