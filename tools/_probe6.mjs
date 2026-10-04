import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe6.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe6_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1440,900'] });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
const nf=[]; page.on('response', r => { if (r.status()===404) nf.push(r.url()); });
page.on('pageerror', e => L('[pageerror] '+String(e.message).slice(0,120)));
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'domcontentloaded', timeout:60000 }).catch(e=>L('goto warn '+String(e.message).slice(0,60)));
await new Promise(r=>setTimeout(r,40000));
// 关弹层
await page.evaluate(() => { const el=[...document.querySelectorAll('button')].find(e=>(e.innerText||'').trim()==='稍后再说'&&e.offsetParent!==null); if(el) el.click(); }).catch(()=>{});
await new Promise(r=>setTimeout(r,1000));
// 点开始游戏
const btn = await page.evaluate(`(() => { try { const scene=cc.director.getScene(); let hit=null; scene.walk((n)=>{ if(hit||!n.activeInHierarchy) return; const lb=n.getComponent&&n.getComponent(cc.Label); if(lb&&/开始游戏/.test(lb.string||'')) hit=n; }); if(!hit) return null; const wp=hit.parent.convertToWorldSpaceAR(hit.position); return {x:Math.round(0.75*wp.x),y:Math.round(900-0.75*wp.y)}; } catch(e){ return null; } })()`);
L('btn='+JSON.stringify(btn));
if (btn) { await page.mouse.move(btn.x,btn.y); await page.mouse.down(); await new Promise(r=>setTimeout(r,100)); await page.mouse.up(); }
for (const t of [10,30,60,90]) {
  await new Promise(r=>setTimeout(r, t===10?10000:30000));
  await page.screenshot({ path: '/tmp/probe6-'+t+'.png' }).catch(()=>{});
  const st = await page.evaluate(`(() => { try { const m=window.__AF_MODS__; const A=m&&m['Application']&&m['Application'].exports; const i=A&&A.default&&A.default.getIns&&A.default.getIns(); let menuBtn=false; try{ cc.director.getScene().walk(n=>{ if(!menuBtn&&n.activeInHierarchy){const lb=n.getComponent&&n.getComponent(cc.Label); if(lb&&/开始游戏/.test(lb.string||'')) menuBtn=true;} }); }catch(e){} return {pn: i&&i.playerNode?'SET':'null', menuBtn}; } catch(e){ return {err:String(e.message).slice(0,60)}; } })()`);
  L(`t=${t}s ${JSON.stringify(st)} 404s=${nf.length}`);
}
L('404 list: '+JSON.stringify([...new Set(nf)]));
await b.close(); L('done');
