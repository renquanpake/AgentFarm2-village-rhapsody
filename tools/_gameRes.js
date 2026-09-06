const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
// Extract full GameRes block and GamePath
let gameRes=new RegExp("i.GameRes=new function");
let st=s.indexOf("i.GameRes=new function");
let en=s.indexOf(";i.GamePath=", st);
console.log("=== GameRes (offset "+st+" - "+en+") ===");
console.log(s.substring(st, en).replace(/this\./g,"\nthis.").split("\n").slice(0,120).join("\n"));
