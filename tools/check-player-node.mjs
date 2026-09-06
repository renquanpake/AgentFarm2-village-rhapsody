// check-player-node.mjs —— 深挖 getIns().playerNode 何时存在
import { connect } from './cdp.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const cdp = await connect();
  await cdp.eval(`localStorage.setItem('af_token','${login.token}'); localStorage.setItem('af_uid','${login.uid}'); localStorage.setItem('af_nick','test3');`);
  await cdp.eval('location.reload();');
  await wait(18000);
  const r = await cdp.eval(`(() => {
    const mods = window.__AF_MODS__ || {};
    const App = mods['Application'] && mods['Application'].exports;
    const inst = App && App.default && App.default.getIns && App.default.getIns();
    if (!inst) return { err: 'no inst' };
    // 列出实例所有玩家相关属性
    const fields = {};
    for (const k of ['playerNode','prefab_player','mapCamera','sceneSize','pnlSceneLayer','pnlUiLayer']) {
      fields[k] = {
        val: typeof inst[k],
        has: k in inst,
      };
    }
    // 找 scene 里的所有 Player/角色节点
    let sceneNodes = [];
    try {
      const s = cc.director.getScene();
      if (s) {
        const c = s.getChildByName('Canvas');
        if (c) c.walk(n => { if (n.name && (n.name.includes('Player') || n.name.includes('player') )) sceneNodes.push({ name:n.name, x:Math.round(n.x), y:Math.round(n.y), active:n.active, childCount:n.children.length }); });
      }
    } catch(e){ sceneNodes = [{err: e.message}]; }
    // PlayerItem 组件
    const PI = mods['PlayerItem'];
    return { fields, instKeys: Object.keys(inst).slice(0,40), sceneNodes };
  })()`);
  console.log('结果:', JSON.stringify(r.value, null, 1));
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
