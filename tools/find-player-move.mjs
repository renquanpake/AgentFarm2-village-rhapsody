// find-player-move.mjs —— 找原版主角移动机制与相机跟随
import { readFileSync } from 'node:fs';
const s = readFileSync('D:/agent社区/AgentFarm2/client/assets/main/index.e6d95.js', 'utf8');

const keywords = ['setPosition', 'setMoveDir', 'setMainCamera', 'camera.follow', 'playerNode.position', '.x +=', 'setCamera', 'followTarget', 'playerNode='];
for (const kw of keywords) {
  let idx = 0, cnt = 0;
  while ((idx = s.indexOf(kw, idx)) >= 0 && cnt < 3) {
    console.log(`\n【${kw}】 @${idx}:`);
    console.log('  ...' + s.slice(Math.max(0, idx - 140), idx + 160).replace(/\n/g, ' '));
    idx += 10; cnt++;
  }
}
