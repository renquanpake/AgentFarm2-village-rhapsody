// 调试：检查注入的碰撞体状态 + 玩家物理组件
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(m.text()));
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(20000);
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
const info = await page.evaluate(() => {
  const out = { physics: null, walls: [], player: null };
  try {
    const pm = cc.director.getPhysicsManager();
    out.physics = { enabled: pm.enabled, hasWorld: !!pm.physicsWorld };
    const scene = cc.director.getScene();
    const canvas = scene && scene.getChildByName('Canvas');
    const walls = [];
    canvas && canvas.walk(node => { if (node.name === 'af-wall') walls.push(node); });
    out.walls = walls.slice(0, 4).map(n => {
      const rb = n.getComponent(cc.RigidBody);
      const bc = n.getComponent(cc.PhysicsBoxCollider);
      return {
        pos: { x: Math.round(n.x), y: Math.round(n.y) },
        rbType: rb ? rb.type : null,
        rbActive: rb ? rb.active : null,
        colliderEnabled: bc ? bc.enabled : null,
        size: bc ? { w: bc.size.width, h: bc.size.height } : null,
      };
    });
    out.wallCount = walls.length;
    const m = window.__AF_MODS__;
    const pnode = m.Application.exports.default.getIns().playerNode;
    const prb = pnode.getComponent(cc.RigidBody);
    const pbc = pnode.getComponent(cc.PhysicsBoxCollider);
    out.player = {
      rbType: prb ? prb.type : null,
      rbActive: prb ? prb.active : null,
      collider: pbc ? { enabled: pbc.enabled, size: { w: pbc.size.width, h: pbc.size.height } } : null,
      group: pnode.group,
    };
  } catch (e) { out.err = e.message; }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
