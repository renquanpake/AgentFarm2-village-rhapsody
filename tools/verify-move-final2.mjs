// verify-move-final2.mjs —— CDP 登录 → 等 agent → 连续采样节点位置
import { connect } from './cdp.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '55', password: '55123456' }) })).json();
  const cdp = await connect();
  // 注入凭证并刷新
  await cdp.eval(`localStorage.setItem('af_token','${login.token}'); localStorage.setItem('af_uid','${login.uid}'); localStorage.setItem('af_nick','55');`);
  await cdp.eval('location.reload();');
  await wait(18000);
  const st = await cdp.eval(`({ mods: Object.keys(window.__AF_MODS__||{}).length, loginUI: !!document.getElementById('af-login'), cc: !!window.cc })`);
  console.log('游戏状态:', JSON.stringify(st.value));

  // 采样 10 次（每次 5 秒），观察 agent 节点位置变化
  let prev = null, positions = [];
  for (let i = 0; i < 10; i++) {
    await wait(5000);
    const r = await cdp.eval(`(() => {
      try {
        const scene = cc.director.getScene();
        if (!scene) return { err: 'no scene' };
        const canvas = scene.getChildByName('Canvas');
        if (!canvas) return { err: 'no canvas' };
        const out = [];
        canvas.walk(n => { if (n.name === 'AFName') out.push({ x: Math.round(n.parent.x), y: Math.round(n.parent.y), active: n.parent.active, valid: n.parent.isValid }); });
        return { nodes: out };
      } catch (e) { return { err: e.message }; }
    })()`);
    const cur = r.value && r.value.nodes && r.value.nodes[0];
    if (cur) {
      const dx = prev ? cur.x - prev.x : 0, dy = prev ? cur.y - prev.y : 0;
      const moved = prev && (Math.abs(dx) > 50 || Math.abs(dy) > 50);
      positions.push(`(${cur.x},${cur.y})`);
      console.log(`[${i+1}] (${cur.x},${cur.y}) Δ=(${dx},${dy})` + (moved ? ' ★' : ''));
      prev = cur;
    } else {
      console.log(`[${i+1}]`, JSON.stringify(r.value));
    }
  }
  cdp.close();
  // 判断是否移动
  const unique = new Set(positions);
  console.log('轨迹:', positions.join(' → '));
  console.log(unique.size > 1 ? '\n✅ Agent 在移动！' : '\n❌ Agent 未移动');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
