const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
let startIdx=s.indexOf('i.GameRes=new function');
let gp=s.indexOf('i.GamePath=', startIdx);
let block=s.substring(startIdx, gp);
// extract all property assignments this.NAME=new o.ResItem("RES",type)
let re=/\bthis\.([A-Z0-9_]+)=new o\.ResItem\("([^"]+)",(cc\.\w+)\)/g;
let m,list=[];
while((m=re.exec(block))!==null){list.push(m[1]+"  <=res:"+m[2]+" "+m[3]);}
console.log("Total GameRes entries:",list.length);
console.log(list.join("\n"));
