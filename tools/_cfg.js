const fs=require("fs");
const s=fs.readFileSync("D:\\迅雷云盘\\VillageRhapsody\\resources\\app\\game\\assets\\main\\index.e6d95.js","utf8");
["Gnpc_config","Gtalk_group_config","Gscene_config","Gshop_config","Language","Gwords","ConfigureHelper"].forEach(n=>{
  let i=s.indexOf(n+":[function");
  let name="NOT_FOUND";
  if(i>=0){
    let j=s.indexOf("_RF.push(t,",i);
    let m=s.indexOf("):",j);
    name=s.substring(j, m+2);
  }
  console.log(n.padEnd(22), i>=0?("at "+i):"NOT_FOUND", " ", name);
});
