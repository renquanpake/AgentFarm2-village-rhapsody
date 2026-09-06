const {s}=require('./_lib.js');
const i=s.indexOf('UiStorage:[function');
console.log('UiStorage @',i);
// saveData / haveArchive / onBtnSave references in UiStorage
let block=s.substring(i, i+4000);
['saveData','haveArchive','storageKey','startGame','onBtnSave','reWriteData','getData'].forEach(k=>{
  const re=new RegExp('\\b'+k,'g'); let m,c=0;
  while((m=re.exec(block))!==null && c<3){ console.log('  ['+k+'] @rel',m.index,'abs',i+m.index); c++; }
});
console.log('---tail snippet around save---');
let si=block.indexOf('saveData');
console.log(block.substring(Math.max(0,si-400), si+300));
