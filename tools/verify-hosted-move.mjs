// 托管冒烟测试：新账号进世界后，Agent 移动必须驱动同一个 playerNode。
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const once = (ws, type) => new Promise(resolve => ws.on('message', raw => {
  const msg = JSON.parse(raw);
  if (msg.t === type) resolve(msg);
}));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'],
});

try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#af-user');
  await page.type('#af-user', 'host' + Date.now().toString(36));
  await page.type('#af-pass', 'pass1234');
  await page.click('#af-login-btn');
  await page.waitForFunction(() => !document.getElementById('af-login'), { timeout: 20000 });
  await wait(8000);
  await page.mouse.click(640, 416);
  await wait(5000);
  await page.mouse.click(640, 224);
  await wait(12000);
  await page.waitForFunction(() => {
    const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
    return !!app?.playerNode;
  }, { timeout: 25000 });

  const before = await page.evaluate(() => {
    const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode;
    return { x: Math.round(n.x), y: Math.round(n.y) };
  });
  const agentToken = await page.evaluate(async () => {
    const token = localStorage.getItem('af_token');
    return (await (await fetch('/af/agent-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    })).json()).agentToken;
  });
  const ws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + encodeURIComponent(agentToken));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await once(ws, 'welcome');
  ws.send(JSON.stringify({ t: 'act', action: 'move', dir: 'right', seq: 1 }));
  const result = await once(ws, 'result');
  await wait(300);
  const after = await page.evaluate(() => {
    const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode;
    return { x: Math.round(n.x), y: Math.round(n.y) };
  });
  const mapNodes = await page.evaluate(() => {
    const names = [];
    cc.director.getScene()?.getChildByName('Canvas')?.walk(n => {
      if (/map/i.test(n.name)) names.push(n.name);
    });
    return [...new Set(names)];
  });
  await page.evaluate(() => {
    let button = null;
    cc.director.getScene()?.getChildByName('Canvas')?.walk(n => { if (n.name === 'btnMap') button = n; });
    const control = button?.getComponent(cc.Button);
    if (control) cc.Component.EventHandler.emitEvents(control.clickEvents, {});
  });
  await wait(2000);
  const mapTexture = await page.evaluate(() => {
    let uiMap = null;
    cc.director.getScene()?.getChildByName('Canvas')?.walk(n => { if (n.name === 'UiMap') uiMap = n; });
    const content = uiMap?.getChildByName('pnlContent');
    const village = content?.getChildByName('village');
    let spriteNode = null, image = null;
    const rootSprite = village?.getComponent(cc.Sprite);
    if (rootSprite) { spriteNode = village; image = rootSprite.spriteFrame?.getTexture()?._image; }
    const allNodes = [];
    village?.walk(n => {
      allNodes.push({ name: n.name, components: n._components.map(c => c.constructor.name) });
      const sprite = n.getComponent(cc.Sprite);
      if (!image && sprite) { spriteNode = n; image = sprite.spriteFrame?.getTexture()?._image; }
    });
    return {
      active: !!uiMap?.activeInHierarchy,
      imageTag: image?.tagName || null,
      villageChildren: village?.children.map(n => ({ name: n.name, components: n._components.map(c => c.constructor.name) })) || [],
      villageComponents: village?._components.map(c => c.constructor.name) || [],
      spriteNode: spriteNode?.name || null,
      allNodes,
      contentChildren: uiMap?.getChildByName('pnlContent')?.children.map(n => ({
        name: n.name, active: n.active, components: n._components.map(c => c.constructor.name),
      })) || [],
    };
  });
  ws.close();
  if (!result.ok || after.x === before.x && after.y === before.y) throw new Error('托管未移动玩家本体: ' + JSON.stringify({ before, after, result }));
  if (!mapTexture.active || !mapTexture.spriteNode) throw new Error('扩展小地图未替换: ' + JSON.stringify({ mapTexture, logs: logs.slice(-20) }));
  console.log('PASS hosted player move and map:', JSON.stringify({ before, after, mapNodes, mapTexture }));
} finally {
  await browser.close();
}
