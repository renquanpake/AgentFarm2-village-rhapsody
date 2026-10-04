import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
L('uid='+acc.uid);
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=800,600'] });
const page = await b.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.setCacheEnabled(false);
page.on('console', m => { const t=String(m.text()); if(m.type()==='error') L('[err] '+t.slice(0,120)); else if(/AF|Cocos|scene|player/i.test(t)) L('[b] '+t.slice(0,100)); });
page.on('pageerror', e => L('[pageerror] '+String(e.message).slice(0,200)));
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'networkidle2', timeout:60000 }).catch(e=>L('goto warn '+e.message));
for (const t of [30, 50]) {
  await new Promise(r=>setTimeout(r, t===30?30*1000:20*1000));
  L('--- t='+t+'s single probe ---');
  try {
    const st = await page.evaluate(()=>{
      const out={};
      const mods=window.__AF_MODS__;
      out.mods=mods?Object.keys(mods).length:0;
      try{ const App=mods['Application'].exports; const ins=App.default.getIns();
        out.insKeys=Object.keys(ins).filter(k=>/player|node|hero|pnl/i.test(k));
        out.playerNode=ins.playerNode? 'SET(name='+(ins.playerNode.name||'?')+')' : JSON.stringify(ins.playerNode);
      }catch(e){out.appErr=String(e.message).slice(0,100);}
      try{ const PM=mods['PlayerMoudle'].exports; const g=PM._gPlayer||(PM.default&&PM.default._gPlayer);
        out.gPlayer=g?'yes':'no';
        if(g){ out.gKeys=Object.keys(g).filter(k=>/node|player|scene/i.test(k)).slice(0,15); out.gNode=g.node? 'SET(name='+g.node.name+')':JSON.stringify(g.node); }
      }catch(e){out.pmErr=String(e.message).slice(0,100);}
      try{ out.scene=cc.director.getScene()?cc.director.getScene().name:'null'; }catch(e){out.sceneErr=String(e.message).slice(0,60);}
      return out;
    });
    L(JSON.stringify(st));
  } catch(e){ L('probe err '+String(e.message).slice(0,120)); }
}
await b.close();
L('done');
