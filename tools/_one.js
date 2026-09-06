const fs=require("fs");
const f="D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js";
const s=fs.readFileSync(f,"utf8");
let i=s.indexOf('_RF.push');
console.log(JSON.stringify(s.substring(i,200)));
// also find definitions
const rf=[];
let j=0;while((j=s.indexOf('_RF.push',j))!==-1){rf.push(j);j+=6;}
let b=rf[0]-50; console.log("...pre:",JSON.stringify(s.substring(b,rf[0]+250)));
