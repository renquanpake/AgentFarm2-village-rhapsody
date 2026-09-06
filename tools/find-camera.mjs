// find-camera.mjs —— 找地图相机跟随主角逻辑
import { readFileSync } from 'node:fs';
const s = readFileSync('D:/agent社区/AgentFarm2/client/assets/main/index.e6d95.js', 'utf8');
const kws = ['mapCamera', 'follow', 'getPosition', 'camera', 'Camera', 'setPosition4', 'playerNode.getPosition'];
for (const kw of kws) {
  let idx = 0;
  const hits = [];
  while ((idx = s.indexOf(kw, idx)) >= 0 && hits.length < 4) {
    const ctx = s.slice(Math.max(0, idx - 100), idx + 150).replace(/\n/g, ' ');
    if (kw === 'mapCamera' || kw === 'follow' || kw === 'Camera') hits.push(ctx);
    idx += kw.length;
  }
  if (hits.length) {
    console.log(`\n===== ${kw} =====`);
    hits.forEach(h => console.log('  ...' + h));
  }
}
