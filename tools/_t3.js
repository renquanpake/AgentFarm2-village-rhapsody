const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
// Search for 'L('calls that name the GameScene class G in GameDefine region. The class is 'G'. find decorator 'L(ccclass(...),G' or property decorators. Search region 370000-400000 for 'ccclass(' calls
let seg=s.substring(344000, 403000);
let i=0,hits=[];
while((i=seg.indexOf("ccclass(",i))!==-1){ hits.push(344000+i); i+=7; }
console.log("ccclass( count:",hits.length);
hits.forEach(h=>console.log(h, JSON.stringify(s.substring(h,h+80))));
