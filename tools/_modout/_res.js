const s=require("../_lib.js").s;
const off=s.indexOf('ResDefine:[function(e,t,i){');
const b=s.substring(off,s.indexOf('cc._RF.pop()',off));
console.log('ResDefine len',b.length);
// find UI_TALK value
const u=b.indexOf('UI_TALK');
const uid=b.indexOf('UI_TALK=');
console.log('UI_TALK at rel',u,'def idx',uid);
console.log('UI_TALK =', b.substring(b.lastIndexOf(',',uid-1), uid+30));
// GamePath keys
console.log('=== n/c path keys ===');
const keys=[...b.matchAll(/[A-Z][A-Z0-9_:]*:(?:(?!"([0-9]))[^,}]){0,40}/g)];
keys.slice(0,25).forEach(mm=>console.log(mm[0]));
