const {s}=require('./_lib.js');
function all(pat,lim){const re=new RegExp(pat);let out=[],m;while((m=re.exec(s))){out.push(m.index);if(out.length>=lim)break;}return out;}
console.log('StorageUtil module:', all(/StorageUtil:\[function/,1)[0]);
['getItem=function','getNum=function','setItem=function','removeItem=function','getObj=function','setObj=function'].forEach(k=>{
  // only inside StorageUtil region
  const st=s.indexOf('StorageUtil:[function');
  const en=s.indexOf('StreetLamp:[function');
  const local=s.indexOf(k,st);
  console.log('  '+k+' @', st+ (local>st&&local<en? local-st : -1));
});
