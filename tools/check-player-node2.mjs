// check-player-node2.mjs —— 检查 playerNode 本身的场景归属/组件/位置
import { connect } from './cdp.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const cdp = await connect();
  await cdp.eval(`localStorage.setItem('af_token','${login.token}'); localStorage.setItem('af_uid','${login.uid}'); localStorage.setItem('af_nick','test3');`);
  await cdp.eval('location.reload();');
  await wait(20000);
  const r = await cdp.eval(`(() => {
    const mods = window.__AF_MODS__ || {};
    const App = mods['Application'] && mods['Application'].exports;
    const inst = App && App.default && App.default.getIns && App.default.getIns();
    const pn = inst && inst.playerNode;
    if (!pn) return { err: 'no playerNode' };
    const comps = pn.components ? pn.components.map(c => c.constructor && c.constructor.name) : [];
    const pos = pn.getPosition ? pn.getPosition() : null;
    return {
      name: pn.name,
      active: pn.active,
      activeInHierarchy: pn.activeInHierarchy,
      valid: pn.isValid,
      parent: pn.parent && pn.parent.name,
      parentValid: pn.parent && pn.parent.isValid,
      childCount: pn.children && pn.children.length,
      components: comps.slice(0,15),
      pos: pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null,
    };
  })()`);
  console.log('playerNode:', JSON.stringify(r.value, null, 1));
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
