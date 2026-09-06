const {s}=require('./_lib.js');
const i=s.indexOf('ModuleBase:[function');
let block=s.substring(i, i+1200);
console.log(block);
