const {s}=require('./_lib.js');
for(const [name,pat] of [['GameData','GameData:[function'],['AudioManager','AudioManager:[function'],['WebApi','WebApi:[function'],['FarmMoudle','FarmMoudle:[function'],['DataManager','DataManager:[function'],['SceneManager','SceneManager:[function']]){
  const i=s.indexOf(pat);
  if(i<0){console.log(name,'NOT FOUND as module key');continue;}
  console.log('\n=====',name,'@',i,'=====');
  console.log(s.substring(i, i+1200));
}
