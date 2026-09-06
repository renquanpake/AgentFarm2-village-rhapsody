// Extract full module source including the requires map, for a list of modules
const fs=require("fs");
const {s,mods}=require("../_lib.js");
const want=process.argv.slice(2);
mods.forEach(m=>{
  if(!want.includes(m.name)) return;
  const off=m.off;
  let start=s.indexOf('[function',off);
  let brace=s.indexOf('{',start+1);
  let depth=0,i=brace;
  function skipQuote(k,q){let j=k+1;while(j<s.length){if(s[j]==='\\'){j+=2;continue;}if(s[j]===q)return j+1;j++;}return j;}
  for(;i<s.length;i++){let c=s[i];if(c==='"'||c==="'"){i=skipQuote(i,c)-1;continue;}if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)break;}}
  // find closing of module: after block, the trailing ,{requires} then }
  let j=i+1; // at closing brace of function
  // find module end: cc._RF.push(...) ... then '}' then comma then requires object then '}' then '}'
  // capture up to the '}' that closes the module after requires map (next module starts with 'name:[function')
  let nextOff=-1;
  for(const m2 of mods){ if(m2.off>off){ nextOff=m2.off; break; } }
  let end = nextOff>0? nextOff : s.length;
  let block=s.substring(off,end);
  fs.writeFileSync("D:\\agent社区\\AgentFarm2\\tools\\_modout\\full_"+m.name+".js",block);
  console.log("WROTE full_"+m.name+".js len="+block.length+" off="+off+" next="+nextOff);
});
