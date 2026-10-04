import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe4.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE+p, b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}); const t=await r.text(); try{return JSON.parse(t)}catch{return {raw:t.slice(0,80)}}; };
const U='probe4_'+(Date.now()%1e6);
let acc = await j('/af/register',{username:U,password:'probe123'});
if(!acc.token) acc = await j('/af/login',{username:U,password:'probe123'});
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1440,900'] });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
page.on('pageerror', e => L('[pageerror] '+String(e.message).slice(0,150)));
page.on('console', m => { const t=String(m.text()); if (/(GAMEINFO|loadScene|Login|login|Storage|开始|UiMain)/.test(t)) L('[c] '+t.slice(0,110)); });
await page.evaluateOnNewDocument((c)=>{ try{ localStorage.setItem('af_token',c.token); localStorage.setItem('af_uid',c.uid); localStorage.setItem('af_nick',c.nick); localStorage.setItem('af.test','1'); }catch(e){} }, {token:acc.token,uid:acc.uid,nick:U});
await page.goto(BASE+'/', { waitUntil:'networkidle2', timeout:80000 }).catch(e=>L('goto warn '+String(e.message).slice(0,80)));
L('goto done');
await new Promise(r=>setTimeout(r,15000));
// 找按钮并点击（用 mouse.down/up 更贴近 Cocos）
const btn = await page.evaluate(`(() => {
  try { const scene = cc.director.getScene(); if(!scene) return null; let hit=null;
    scene.walk((n)=>{ if(hit||!n.activeInHierarchy) return; const lb=n.getComponent&&n.getComponent(cc.Label); if(lb&&/开始游戏/.test(lb.string||'')) hit=n; });
    if(!hit) return null; const wp=hit.parent?hit.parent.convertToWorldSpaceAR(hit.position):hit.position;
    return { x: Math.round(0.75*wp.x), y: Math.round(900-0.75*wp.y), name: hit.name, btnParent: hit.parent && hit.parent.name };
  } catch(e){ return {err:String(e.message).slice(0,60)}; }
})()`);
L('btn=' + JSON.stringify(btn));
if (btn && !btn.err) { await page.mouse.move(btn.x, btn.y); await page.mouse.down(); await new Promise(r=>setTimeout(r,120)); await page.mouse.up(); L('mouse down/up at '+btn.x+','+btn.y); }
await new Promise(r=>setTimeout(r,5000));
await page.screenshot({ path: '/tmp/probe4-shot1.png' });
// 看场景树前几层与按钮/节点状态
const tree = await page.evaluate(`(() => {
  try {
    const scene = cc.director.getScene(); const nodes=[];
    scene.walk((n,d)=>{ if(d<=3) nodes.push(' '.repeat(d*2)+n.name+(n.activeInHierarchy?'':'(隐)')); });
    const ins = window.__AF_MODS__.Application.exports.default.getIns();
    return { topNodes: nodes.slice(0,50), playerNode: ins.playerNode ? 'SET' : 'null', labels: (()=>{ const out=[]; scene.walk(n=>{ if(out.length<12){ const lb=n.getComponent&&n.getComponent(cc.Label); if(lb&&lb.string&&n.activeInHierarchy) out.push(lb.string.slice(0,20)+'@'+n.name); } }); return out; })() };
  } catch(e){ return {err:String(e.message).slice(0,80)}; }
})()`);
L('tree=' + JSON.stringify(tree, null, 1));
await new Promise(r=>setTimeout(r,10000));
await page.screenshot({ path: '/tmp/probe4-shot2.png' });
const pn = await page.evaluate(`(() => { try { const ins=window.__AF_MODS__.Application.exports.default.getIns(); return ins.playerNode?('SET pos='+ins.playerNode.getPosition().x.toFixed(0)+','+ins.playerNode.getPosition().y.toFixed(0)):'null'; } catch(e){ return 'ERR'; } })()`);
L('playerNode after +15s: '+pn);
await b.close(); L('done');
