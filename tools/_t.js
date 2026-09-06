const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
let searchFrom=376000, searchTo=400000;
let seg=s.substring(searchFrom, searchTo);
let i=0, hits=[];
while((i=seg.indexOf('L("',i))!==-1){ hits.push(searchFrom+i); i+=2; }
console.log("ccclass L(...) count in region:", hits.length);
hits.forEach(h=>console.log(h, JSON.stringify(s.substring(h, h+60))));
