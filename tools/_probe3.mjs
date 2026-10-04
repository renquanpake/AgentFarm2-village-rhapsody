import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe3.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe3_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
L('uid='+acc.uid);
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=800,600','--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.setCacheEnabled(false);
page.on('pageerror', e => L('[pageerror] '+String(e.message).slice(0,150)));
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'networkidle2', timeout:60000 }).catch(e=>L('goto warn '+e.message));
const pnAt = async (label) => { let pn='?'; try{ pn = await page.evaluate(()=>{ const m=window.__AF_MODS__; if(!m||!m['Application'])return 'noApp'; const ins=m['Application'].exports.default.getIns(); return ins.playerNode?('SET '+(ins.playerNode.name||'')+' @'+ins.playerNode.getPosition().x.toFixed(0)+','+ins.playerNode.getPosition().y.toFixed(0)):('null'); }); }catch(e){ pn='ERR '+String(e.message).slice(0,50); } L(label+' playerNode='+pn); return pn.startsWith('SET'); };
await pnAt('t=+8s  before-gesture:');
// 用户手势：点击 canvas + 按一次键
try {
  const canvas = await page.$('canvas');
  if (canvas) { await canvas.click(); }
  await page.keyboard.press('a');
  L('gesture sent');
} catch(e){ L('gesture err '+e.message); }
for (let i=1;i<=8;i++){
  await new Promise(r=>setTimeout(r,5000));
  if (await pnAt(`t=+${8+5*i}s after-gesture:`)) break;
}
await b.close();
L('done');
