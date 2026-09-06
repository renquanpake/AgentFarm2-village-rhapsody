const fs=require('fs');
const s=fs.readFileSync('D:/迅雷云盘/VillageRhapsody/resources/app/game/assets/main/index.e6d95.js','utf8');
const re=/cc\._RF\.push\(t,"([a-f0-9]+)","([^"]+)"\)/g;
const names=new Set();let count=0;
s.replace(re,(a,h,n)=>{names.add(n);count++});
console.log('RF push count:',count);
console.log('unique names:',names.size);
console.log([...names].join('\n'));
