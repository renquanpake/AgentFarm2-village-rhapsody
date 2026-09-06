const {s}=require('./_lib.js');
const i=s.indexOf('WebApi:[function');
// find module block end: next [function after length
const seg=s.substring(i, s.length);
const end=seg.search(/\],WebApi/);
const nextKey=seg.search(/\],?[A-Za-z]+:\[function/);
console.log('WebApi module @',i,'len-candidate end',nextKey);
let block=seg.substring(0, nextKey>0?nextKey:9000);
console.log(block);
