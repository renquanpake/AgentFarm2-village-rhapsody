// count-players.mjs —— 数场景里所有"主角样"节点 + 检查 remote 渲染
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
    const s = cc.director.getScene();
    if (!s) return { err: 'no scene' };
    // 场景里所有节点及其 PlayerItem/角色组件
    const all = [];
    s.walk(n => {
      const comps = n.components ? n.components.map(c => c && c.constructor && c.constructor.name) : [];
      const hasPlayerItem = comps.includes('PlayerItem');
      const hasAF = n.name === 'AFName';
      if (hasPlayerItem || hasAF || (n.name && (n.name.includes('Player')||n.name.includes('player')||n.name.includes('Role')))) {
        all.push({ name: n.name, pos: n.getPosition ? { x: Math.round(n.getPosition().x), y: Math.round(n.getPosition().y) } : null, hasPlayerItem, active: n.active, parent: n.parent && n.parent.name, comps: comps.slice(0,5) });
      }
    });
    const remotes = window.__AF__ ? Array.from(window.__AF__.remotePlayers?.keys() || []) : [];
    return { nodeCount: all.length, nodes: all, remotePlayers: remotes };
  })()`);
  console.log('场景节点:', JSON.stringify(r.value, null, 1));
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
