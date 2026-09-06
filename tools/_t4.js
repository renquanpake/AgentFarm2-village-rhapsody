const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
function wrap(t){const w=t.match(/.{1,110}/g).join("\n");console.log(w);}
// property decorators list around 375513
console.log("=== property decorators @375500 ==="); wrap(s.substring(375400,376600));
