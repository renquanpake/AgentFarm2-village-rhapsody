const {s}=require('./_lib.js');
// Search for module heads that require StorageUtil or SdkManager and show their direct var alias assignment
const start=s.indexOf('AchvMoudle:[function');
console.log('AchvMoudle @',start);
console.log('---head---');
console.log(s.substring(start, start+1500));
