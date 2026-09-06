const {s}=require('./_lib.js');
function findAll(re,s,limit){let out=[],m;while((m=re.exec(s))!==null){out.push(m.index);if(out.length>=limit)break;}return out;}
const report={};
report.PlayerInit=findAll(/e\.prototype\.init=function\(e,t\)\{void 0===t&&\(t=" "\),this\.storageKey=e/s,1)[0]||1705742;
report.PlayerLoadLoop=findAll(/;i<o\.length;i\+\+\)o\[i\]\.loadData\(this\.storageKey\)/,1)[0];
report.PlayerSaveLoop=findAll(/for\(var o=0,a=this\.modules;o<a\.length;o\+\+\)a\[o\]\.saveData\(this\.storageKey\)/,1)[0];
report.StorageKeyFn=findAll(/getStorageKey=function\(e,t\)\{return t\+"_"\+e\}/,1)[0];
report.GMSaveData=findAll(/t\.prototype\.saveData=function\(\)\{E\._gPlayer\.saveData\(\)/,1)[0];
report.GMLoginSdk=findAll(/loginSdk=function\(\)\{var e=this;h\.default\.login/,1)[0];
report.startTimeSchedule=findAll(/startTimeSchedule=function\(\)\{var e=this;this\.stopTimeSchedule/,1)[0];
report.updateTime=findAll(/updateTime=function\(\)\{this\.time\+=1/,1)[0];
// each module's key call
['playerData','mapData','plantData','taskData','npcData','knapData','shopData','makeData','castingData','attributeData','achvData','settingData','buffData','plotData','farmData'].forEach(k=>{
  const r1=findAll(new RegExp('getStorageKey\\(e,\\"'+k+'\\"\\)','g'),1)[0];
  const r2=findAll(new RegExp('getStorageKey\\(e,\\"'+k+'\\"\\)','g'),20);
  report['key_'+k]={call:r1,count:r2.length};
});
console.log(JSON.stringify(report,null,1));
