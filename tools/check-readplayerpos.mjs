// check-readplayerpos.mjs —— 验证 readPlayerPos 依赖的模块结构是否可用
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
    const PM = mods['PlayerMoudle'];
    const App = mods['Application'];
    const PMe = PM && PM.exports;
    const Ape = App && App.exports;
    let detail = {};
    try {
      detail.pm = {
        exists: !!PM, hasExports: !!PMe,
        keys: PMe ? Object.keys(PMe).slice(0,20) : 'none',
        hasGlobal: !!(PMe && (PMe._gPlayer || (PMe.default && PMe.default._gPlayer))),
      };
    } catch(e){ detail.pm = { err: e.message }; }
    try {
      detail.app = {
        exists: !!App, hasExports: !!Ape,
        keys: Ape ? Object.keys(Ape).slice(0,20) : 'none',
        hasDefault: !!(Ape && Ape.default),
        getInsFn: !!(Ape && Ape.default && Ape.default.getIns),
      };
    } catch(e){ detail.app = { err: e.message }; }
    // 尝试直接取位置
    try {
      const node = Ape && Ape.default && Ape.default.getIns && Ape.default.getIns().playerNode;
      const p = node ? node.getPosition() : null;
      detail.playerNodePos = p ? { x: Math.round(p.x), y: Math.round(p.y) } : 'null';
    } catch(e){ detail.playerNodePos = 'err: '+e.message; }
    return detail;
  })()`);
  console.log('模块检查:', JSON.stringify(r.value, null, 1));
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
