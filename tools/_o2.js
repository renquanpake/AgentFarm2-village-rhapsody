const {s}=require('./_lib.js');
function all(pat,lim){const re=new RegExp(pat);let out=[],m;while((m=re.exec(s))){out.push(m.index);if(out.length>=lim)break;}return out;}
console.log('Player module load loop (mods[i].loadData):', all(/i\.loadData\(this\.storageKey\)/,1)[0]);
console.log('Player module save loop (mods[o].saveData):', all(/a\[o\]\.saveData\(this\.storageKey\)/,1)[0]);
console.log('storageKey concat t+"_"+e:', all(/getStorageKey=function\(e,t\)\{return t/,1)[0]);
console.log('GameManager.saveData:', all(/saveData=function\(\)\{E\._gPlayer/,1)[0]);
console.log('startTimeSchedule 500ms:', all(/timeHandle=setInterval\(function\(\)\{e\.updateTime\(\)\},500\)/,1)[0]);
console.log('updateTime (no save):', all(/updateTime=function\(\)\{this\.time\+=1/,1)[0]);
console.log('GameData storageKeys+getStorageKey:', all(/storageKeys=\[100001,200001,300001\]/,1)[0]);
console.log('GameData.getStorageKey(k){return storageKeys[k]}:', all(/getStorageKey=function\(e\)\{return this\.storageKeys\[e\]\}/,1)[0]);
console.log('StateBase.updateStorageKey->GameData:', all(/storageKey=y\.default\.getStorageKey\(this\.storageIdx-1\)/,1)[0]);
console.log('WebApi file name villagedb_:', all(/storageFileName="villagedb_"/,1)[0]);
console.log('WebApi login getUserId->datas:', all(/getUserId\(function\(o,n,a\)/,1)[0]);
console.log('WebApi saveStorageData .qt:', all(/h\.saveData\(this\.storageFileName\+"\.qt"/,1)[0]);
console.log('WebApi getData {version,datas}:', all(/getData=function\(\)\{var e=\{version/,1)[0]);
console.log('NativeApi login init 1000001:', all(/initStorageFile\("1000001"\)/,1)[0]);
console.log('haveArchive playerData_+e:', all(/haveArchive=function\(e\)\{return this\.getStorageObj\("playerData_"\+e/,1)[0]);
