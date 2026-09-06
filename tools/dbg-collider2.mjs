// 对照组：原版树是否挡玩家？+ 物理 API 细节
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(20000);
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);

const info = await page.evaluate(async () => {
  const out = {};
  const pm = cc.director.getPhysicsManager();
  out.pmKeys = Object.keys(pm).filter(k => /world|step|update/i.test(k)).slice(0, 10);
  out.physicsWorldType = typeof pm.physicsWorld;
  out.rigidBodyTypeEnum = cc.RigidBodyType ? { STATIC: cc.RigidBodyType.STATIC, KINEMATIC: cc.RigidBodyType.KINEMATIC, DYNAMIC: cc.RigidBodyType.DYNAMIC } : 'MISSING';
  out.collisionMatrixDefault = pm.collisionMatrix ? 'exists' : 'no';
  const m = window.__AF_MODS__;
  const pnode = m.Application.exports.default.getIns().playerNode;
  const prb = pnode.getComponent(cc.RigidBody);
  out.playerRbType = prb ? prb.type : 'no-rb';
  out.playerBodyImpl = prb && prb.impl ? 'has impl' : 'no impl';
  return out;
});
console.log(JSON.stringify(info, null, 1));

// 原版树阻挡测试：把玩家传送到 (5000, 2600)（村中部的树区？不确定）—— 改为测试：原地向前走，看是否被树篱挡（玩家在 2600,500 树根家门口，树篱在 x 1675-2925）
const p0 = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  return m.Application.exports.default.getIns().playerNode.getPosition();
});
// 玩家出生 2600,500，向左走（a 键）会撞树篱（x=1675 左墙）
await page.keyboard.down('a'); await wait(4000); await page.keyboard.up('a');
const p1 = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  return m.Application.exports.default.getIns().playerNode.getPosition();
});
console.log('左走: 前', Math.round(p0.x), Math.round(p0.y), '后', Math.round(p1.x), Math.round(p1.y));
await browser.close();
