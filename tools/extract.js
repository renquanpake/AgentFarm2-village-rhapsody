// extract.js MODULENAME
// prints the whole module source block from "Name:[function(e,t,i){" forward to the matching bracket close.
const fs=require("fs");
const {s,idx}=require("./_lib.js");
const want=process.argv[2];
const off=idx[want];
if(!off){ console.log("MODULE NOT FOUND:",want); process.exit(1);}
// from offset, find the ':[function' start
let start=s.indexOf('[function',off);
// find '{' after [function
let brace=s.indexOf('{',start+1);
// tokenize scan from brace to find matching close brace, respecting strings & braces
let depth=0,i=brace;
function skipQuote(k,q){
  let j=k+1;
  while(j<s.length){ if(s[j]==='\\'){j+=2;continue;} if(s[j]===q){return j+1;} j++; }
  return j;
}
for(;i<s.length;i++){
  let c=s[i];
  if(c==='"'||c==="'"||c==='`'){ i=skipQuote(i,c)-1; continue; }
  if(c==='{') depth++;
  else if(c==='}'){ depth--; if(depth===0) break; }
}
let block=s.substring(off,i+1);
console.log("MODULE",want,"@",off,"LEN",block.length);
console.log(block);
