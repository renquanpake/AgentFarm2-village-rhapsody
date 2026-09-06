const s=require("../_lib.js").s;
const off=s.indexOf('Gnpc_config:[function(e,t,i){');
const end=s.indexOf('cc._RF.pop()',off);
const b=s.substring(off,end);
// parse each o.set(NUM,{...})
const re=/o\.set\((\d+),(\{)/g;
let m, blocks=[];
while((m=re.exec(b))){
  let start=m.index+ m[0].indexOf('{');
  // find matching close brace for this object
  let depth=0,i=start;
  function skipQuote(k,q){let j=k+1;while(j<b.length){if(b[j]==='\\'){j+=2;continue;}if(b[j]===q)return j+1;j++;}return j;}
  for(;i<b.length;i++){let c=b[i];if(c==='"'||c==="'"){i=skipQuote(i,c)-1;continue;}if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)break;}}
  blocks.push({id:+m[1], obj:b.substring(start,i+1), off:off+start});
}
console.log("total keys:",blocks.length);
blocks.forEach(bk=>{
  const get=(k)=> (bk.obj.match(new RegExp(k+':\\[?[^,}]*')).defaultValue) ;
  const field=(k)=>{const re2=new RegExp('(^|,|\\{)"?'+k+'"?:','g'); const mm=re2.exec(bk.obj); return mm?mm.index:null;};
  // extract known scalar fields
  const grab=(k)=>{const r=new RegExp('(?:^|[,{])'+k+':([^,]*)(?:,|})');const mm=bk.obj.match(r);return mm?mm[1]:'';};
  console.log(`id=${bk.id} nameId=${grab('nameId')} gender=${grab('gender')} head=${grab('head')} path_name=${grab('path_name')} scale=${grab('scale')} shop?gift_props=${grab('give_props')} animal=${grab('animal_id')}`);
});
