const fs=require("fs");
const f="D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js";
const s=fs.readFileSync(f,"utf8");
const re=/cc\._RF\.push\(t,"([0-9A-Za-z]+)","([^"]*)"/g;
const out=[];let m;
while((m=re.exec(s))!==null){ out.push({off:m.index,name:m[2]}); }
fs.writeFileSync("D:\\agent社区\\AgentFarm2\\tools\\_module_offsets.json",JSON.stringify(out));
console.log("count:",out.length);
const names=out.map(x=>x.name).sort((a,b)=>a.localeCompare(b));
console.log(names.join("\n"));
