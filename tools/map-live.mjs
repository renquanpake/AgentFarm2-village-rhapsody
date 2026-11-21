import { chromium } from 'playwright-core';
const BASE='https://outstanding-spontaneity-production.up.railway.app';
const CHROME='/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const cred={username:'deployok01',password:'pass1234'};
let auth=await fetch(BASE+'/af/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cred)}).then(r=>r.json());
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:1280,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await p.goto(BASE+'/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(a=>{localStorage.setItem('af_token',a.token);localStorage.setItem('af_uid',a.uid);localStorage.setItem('af_nick',a.nick||a.username);},auth);
await p.reload({waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(16000);

const emit=(sel)=>p.evaluate((sel)=>{const sc=cc.director.getScene();let hit=null;sc.walk(n=>{if(hit)return;let path=[],q=n;while(q&&path.length<6){path.unshift(q.name||'?');q=q.parent;}if(path.join('/').endsWith(sel))hit=n;});if(!hit)return 'no:'+sel;const btn=hit.getComponent(cc.Button);if(btn&&btn.clickEvents&&btn.clickEvents.length){cc.Component.EventHandler.emitEvents(btn.clickEvents,btn);return 'click:'+sel;}return 'nobtn:'+sel;},sel);
console.log(await emit('btnList/btnStart'));
await p.waitForTimeout(3000);

console.log(await p.evaluate(()=>{
  const sc=cc.director.getScene(); let item=null;
  sc.walk(n=>{ if(!item&&/^storageItem\d+$/.test(n.name||'')&&n.activeInHierarchy) item=n; });
  if(!item) return 'no-storage-item';
  const comp=(item._components||[]).find(c=>typeof c.onClick==='function');
  if(!comp) return 'no-onClick';
  comp.onClick({getButton:()=>cc.Event.EventMouse.BUTTON_LEFT});
  return 'storage-click:'+item.name;
}));

for(let i=0;i<12;i++){
  await p.waitForTimeout(5000);
  const st=await p.evaluate(()=>{const out={village:false,scene:'',pos:null};try{const sc=cc.director.getScene();out.scene=sc&&sc.name;sc.walk(n=>{if(n.name==='village'&&n.activeInHierarchy)out.village=true;});const M=window.__AF_MODS__&&window.__AF_MODS__['PlayerMoudle']&&window.__AF_MODS__['PlayerMoudle'].exports;const pl=M&&(M._gPlayer||(M.default&&M.default._gPlayer));if(pl&&pl.getSceneType)out.pos=[pl.getSceneType()];}catch(e){out.err=e.message;}return out;});
  console.log('WAIT',i,JSON.stringify(st));
  if(st.village)break;
}
const btns=await p.evaluate(()=>{const out=[];const sc=cc.director.getScene();sc.walk(n=>{if(!n.activeInHierarchy)return;const btn=n.getComponent&&n.getComponent(cc.Button);if(!btn)return;const labels=[];n.walk&&n.walk(c=>{const l=c.getComponent&&c.getComponent(cc.Label);if(l&&l.string)labels.push(String(l.string).slice(0,8));});out.push({name:n.name,labels:labels.slice(0,2)});});return out.slice(0,50);});
console.log('BTNS',JSON.stringify(btns));
await p.screenshot({path:'/tmp/opencode/world.png'});
console.log('ERR',JSON.stringify(errs.slice(0,5)));
await b.close();
