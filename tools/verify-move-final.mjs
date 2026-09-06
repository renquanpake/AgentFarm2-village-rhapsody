// verify-move-final.mjs —— CDP 连接游戏页面，连续采样 agent 节点位置，验证移动
import { connect } from './cdp.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const cdp = await connect();
  let prev = null, moved = false;
  for (let i = 0; i < 15; i++) {
    await wait(8000);
    const r = await cdp.eval(`(() => {
      try {
        const scene = cc.director.getScene();
        if (!scene) return { err: 'no scene' };
        const canvas = scene.getChildByName('Canvas');
        if (!canvas) return { err: 'no canvas' };
        const nodes = [];
        canvas.walk(n => {
          if (n.name === 'AFName') {
            const p = n.parent;
            nodes.push({ x: Math.round(p.x), y: Math.round(p.y), active: p.active, valid: p.isValid });
          }
        });
        return { nodes, time: Date.now() };
      } catch (e) { return { err: e.message }; }
    })()`);
    const cur = r.value && r.value.nodes && r.value.nodes[0];
    if (cur && prev) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (Math.abs(dx) > 50 || Math.abs(dy) > 50) moved = true;
      console.log(`[${i+1}] (${cur.x},${cur.y}) Δ=(${dx},${dy})` + (moved ? ' ★ 在移动' : ''));
    } else if (cur) {
      console.log(`[${i+1}] (${cur.x},${cur.y}) active=${cur.active} valid=${cur.valid} [初始位置]`);
    } else {
      console.log(`[${i+1}]`, JSON.stringify(r.value));
    }
    if (cur) prev = cur;
  }
  cdp.close();
  console.log(moved ? '\n✅ Agent 在游戏画面中移动了' : '\n❌ Agent 没有移动');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
