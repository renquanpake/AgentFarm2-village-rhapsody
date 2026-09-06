// snippet.js MODNAME REGEX [ctx]  -- print matches inside a module, wrapped
const fs=require("fs");
const {s,idx}=require("./_lib.js");
const want=process.argv[2], reStr=process.argv[3], ctx=parseInt(process.argv[4]||"160",10);
const off=idx[want]; if(!off){console.log("MODULE NOT FOUND");process.exit(1);}
let start=s.indexOf('[function',off);
let brace=s.indexOf('{',start+1);
let depth=0,i=brace;
function skipQuote(k,q){let j=k+1;while(j<s.length){if(s[j]==='\\'){j+=2;continue;}if(s[j]===q)return j+1;j++;}return j;}
for(;i<s.length;i++){let c=s[i];if(c==='"'||c==="'"){i=skipQuote(i,c)-1;continue;}if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)break;}}
let block=s.substring(off,i+1);
let re=new RegExp(reStr,"g"),m,cnt=0;
while((m=re.exec(block))!==null){
  cnt++;
  let abs=off+m.index;
  let snip=block.substring(Math.max(0,m.index-ctx),m.index+ctx);
  // wrap
  const wrapped=snip.match(/.{1,120}/g).join("\n    ");
  console.log("\n=== ["+cnt+"] absOff="+abs+" relOff="+m.index+" ===");
  console.log(wrapped);
  if(cnt>=40)break;
}
console.log("\nmatchCount capped:",cnt);
