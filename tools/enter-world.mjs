import { chromium } from 'playwright-core';
const BASE='https://outstanding-spontaneity-production.up.railway.app';
const CHROME='/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const cred={username:'deployok01',password:'pass1234'};
let auth=await fetch(BASE+'/af/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cred)}).then(r=>r.json());
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:1280,height:800}});
await p.goto(BASE+'/',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate(a=>{localStorage.setItem('af_token',a.token);localStorage.setItem('af_uid',a.uid);localStorage.setItem('af_nick',a.nick||a.username);},auth);
await p.reload({waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(18000);
const click=async(sel)=>p.evaluate((sel)=>{
  const sc=cc.director.getScene(); let hit=null;
  sc.walk(n=>{ if(hit) return; let path=[],q=n; while(q&&path.length<5){path.unshift(q.name||'?');q=q.parent;} if(path.join('/').endsWith(sel)) hit=n; });
  if(!hit) return 'no:'+sel;
  const btn=hit.getComponent(cc.Button);
  if(btn&&btn.clickEvents&&btn.clickEvents.length){ cc.Component.EventHandler.emitEvents(btn.clickEvents,btn); return 'click:'+sel; }
  return 'nobtn:'+sel;
},sel);
console.log(await click('btnList/btnStart'));
await p.waitForTimeout(4000);
const dump=await p.evaluate(()=>{
  const out=[]; const sc=cc.director.getScene();
  sc.walk(n=>{
    if(!n.activeInHierarchy) return;
    const btn=n.getComponent&&n.getComponent(cc.Button);
    if(!btn) return;
    let path=[],q=n; while(q&&path.length<4){path.unshift(q.name||'?');q=q.parent;}
    const labels=[]; n.walk&&n.walk(c=>{const l=c.getComponent&&c.getComponent(cc.Label); if(l&&l.string) labels.push(String(l.string).slice(0,12));});
    out.push({name:n.name,path:path.join('/'),labels:labels.slice(0,3)});
  });
  return out.slice(0,40);
});
console.log(JSON.stringify(dump,null,1));
await p.screenshot({path:'/tmp/opencode/storage.png'});
await b.close();
