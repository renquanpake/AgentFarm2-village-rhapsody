const {s,idx}=require('./_lib.js');
const off=idx.GameManager!==undefined?idx.GameManager:355515;
// find GameManager module start via pattern
let start=s.indexOf('GameManager:[function',0);
const off2=s.indexOf('cc._RF.push',start);
// print from declaration through saveData region
let seg=s.substring(start, start+2600);
console.log('GameManager module @',start);
console.log(seg);
