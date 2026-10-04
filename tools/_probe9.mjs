import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe9.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe9_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1440,900'] });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'domcontentloaded', timeout:60000 }).catch(e=>L('goto warn'));
await new Promise(r=>setTimeout(r,40000));
await page.evaluate(() => { const el=[...document.querySelectorAll('button')].find(e=>(e.innerText||'').trim()==='稍后再说'&&e.offsetParent!==null); if(el) el.click(); }).catch(()=>{});
await new Promise(r=>setTimeout(r,1000));
// 点开始游戏
const clickNode = async (name) => page.evaluate(`(async () => { try { const scene=cc.director.getScene(); let hit=null; scene.walk((n)=>{ if(!hit&&n.activeInHierarchy&&n.name==='${name}') hit=n; }); if(!hit) return null; const wp=hit.convertToWorldSpaceAR(cc.v2(0,0)); return {x:Math.round(0.75*wp.x), y:Math.round(900-0.75*wp.y)}; } catch(e){ return null; } })()`).then(async p => { if (p) { await page.mouse.move(p.x,p.y); await page.mouse.down(); await new Promise(r=>setTimeout(r,80)); await page.mouse.up(); } return p; });
const s1 = await clickNode('btnStart'); L('btnStart click ' + JSON.stringify(s1));
await new Promise(r=>setTimeout(r,5000));
const s2 = await clickNode('btnClose'); L('btnClose click ' + JSON.stringify(s2));
for (let t=15;t<=180;t+=15){
  await new Promise(r=>setTimeout(r,15000));
  const st = await page.evaluate(`(() => { try { const m=window.__AF_MODS__; const A=m&&m['Application']&&m['Application'].exports; const i=A&&A.default&&A.default.getIns&&A.default.getIns(); let pn=i&&i.playerNode; let pos=null; if(pn){try{const p=pn.getPosition();pos=Math.round(p.x)+','+Math.round(p.y);}catch(e){}} return {pn: pn?'SET':'null', pos}; } catch(e){ return {err:String(e.message).slice(0,50)}; } })()`);
  L(`t=${t}s ${JSON.stringify(st)}`);
  if (st.pn==='SET') { await page.screenshot({ path: '/tmp/probe9-world.png' }).catch(()=>{}); break; }
}
await b.close(); L('done');
