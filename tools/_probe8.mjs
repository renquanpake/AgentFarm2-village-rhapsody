import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe8.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe8_'+(Date.now()%1e6);
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
const btn = await page.evaluate(`(() => { try { const scene=cc.director.getScene(); let hit=null; scene.walk((n)=>{ if(hit||!n.activeInHierarchy) return; const lb=n.getComponent&&n.getComponent(cc.Label); if(lb&&/开始游戏/.test(lb.string||'')) hit=n; }); if(!hit) return null; const wp=hit.parent.convertToWorldSpaceAR(hit.position); return {x:Math.round(0.75*wp.x),y:Math.round(900-0.75*wp.y)}; } catch(e){ return null; } })()`);
if (btn) { await page.mouse.move(btn.x,btn.y); await page.mouse.down(); await new Promise(r=>setTimeout(r,100)); await page.mouse.up(); L('clicked start'); }
await new Promise(r=>setTimeout(r,6000));
// 列 mod 选择面板上的按钮节点名
const nodes = await page.evaluate(`(() => { try { const scene=cc.director.getScene(); const out=[]; scene.walk((n,d)=>{ if (n.activeInHierarchy && n.parent && /btn|Btn|close|Close|confirm|ok|sure|start|yes|✕|x$/i.test(n.name)) { try { const wp=n.convertToWorldSpaceAR(cc.v2(0,0)); out.push({name:n.name, parent:n.parent.name, x:Math.round(0.75*wp.x), y:Math.round(900-0.75*wp.y)}); } catch(e){ out.push({name:n.name, parent:n.parent.name}); } } if(out.length>60) return; }); return out; } catch(e){ return {err:String(e.message).slice(0,60)}; } })()`);
L('buttons: ' + JSON.stringify(nodes, null, 1).slice(0, 3000));
await b.close(); L('done');
