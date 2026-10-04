import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe5.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe5_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1440,900'] });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
page.on('pageerror', e => L('[pageerror] '+String(e.message).slice(0,150)));
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'networkidle2', timeout:80000 }).catch(e=>L('goto warn '+String(e.message).slice(0,80)));
for (let pass=0; pass<3; pass++) {
  await new Promise(r=>setTimeout(r, pass===0?6000:3000));
  const btn = await page.evaluate(`(() => { try { const scene=cc.director.getScene(); if(!scene) return null; let hit=null; scene.walk((n)=>{ if(hit||!n.activeInHierarchy) return; const lb=n.getComponent&&n.getComponent(cc.Label); if(lb&&/开始游戏/.test(lb.string||'')) hit=n; }); if(!hit) return null; const wp=hit.parent?hit.parent.convertToWorldSpaceAR(hit.position):hit.position; return { x:Math.round(0.75*wp.x), y:Math.round(900-0.75*wp.y) }; } catch(e){ return null; } })()`);
  if (btn) { await page.mouse.move(btn.x,btn.y); await page.mouse.down(); await new Promise(r=>setTimeout(r,100)); await page.mouse.up(); L('click start pass='+(pass+1)); } else L('no button pass='+(pass+1));
}
for (let t=0;t<=360;t+=15){
  await new Promise(r=>setTimeout(r,15000));
  let pn='?';
  try{ pn = await page.evaluate(`(() => { try { const m=window.__AF_MODS__; if(!m||!m['Application'])return 'noApp'; const ins=m['Application'].exports.default.getIns(); return ins.playerNode?('SET '+(ins.playerNode.name||'')+' @'+ins.playerNode.getPosition().x.toFixed(0)+','+ins.playerNode.getPosition().y.toFixed(0)):('null'); } catch(e){ return 'ERR '+String(e.message).slice(0,40); } })()`); }catch(e){ pn='DEAD'; }
  L(`t=${t+15}s playerNode=${pn}`);
  if (String(pn).startsWith('SET') || pn==='DEAD') break;
}
await page.screenshot({ path: '/tmp/probe5-shot.png' }).catch(e=>L('shot err'));
await b.close().catch(()=>{});
L('done');
