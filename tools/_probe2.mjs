import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe2.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe2_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
L('uid='+acc.uid);
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=800,600'] });
const page = await b.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.setCacheEnabled(false);
const notFound=[];
page.on('response', r => { if (r.status()===404) notFound.push(r.url()); });
page.on('pageerror', e => L('[pageerror] '+String(e.message).slice(0,200)));
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'networkidle2', timeout:60000 }).catch(e=>L('goto warn '+e.message));
// 轮询 playerNode 至 100s，每 5s 一次
for (let t=0;t<=100;t+=5){
  await new Promise(r=>setTimeout(r, t===0?5000:5000));
  let pn='?';
  try{ pn = await page.evaluate(()=>{ const m=window.__AF_MODS__; if(!m||!m['Application'])return 'noApp'; const ins=m['Application'].exports.default.getIns(); return ins.playerNode?('SET '+(ins.playerNode.name||'')+' pos='+ins.playerNode.getPosition().x.toFixed(0)+','+ins.playerNode.getPosition().y.toFixed(0)):('null'); }); }catch(e){ pn='ERR '+String(e.message).slice(0,40); }
  L(`t=${t+5}s playerNode=${pn} 404s=${notFound.length}`);
  if (pn.startsWith('SET')) { L('HERO SPAWNED at '+(t+5)+'s'); break; }
}
L('404 list: '+JSON.stringify([...new Set(notFound)]));
await b.close();
L('done');
