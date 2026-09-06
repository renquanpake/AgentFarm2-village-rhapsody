const {s}=require('./_lib.js');
// find the module declaration that contains offset 369166: back up to a ': [function' boundary
const target=369166;
let seg=s.substring(0,target);
let boundary=seg.lastIndexOf(':[function');
console.log('boundary @',boundary);
// RF push name within
let j=s.indexOf('cc._RF.push',boundary);
console.log(s.substring(j, Math.min(j+120, s.length)));
