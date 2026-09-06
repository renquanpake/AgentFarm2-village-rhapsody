// dbg-mapui.mjs —— 找游戏内地图 UI 的图像资源（little_map_content / prefab / sprite）
import { readFileSync } from 'node:fs';
const s = readFileSync('D:/agent社区/AgentFarm2/client/assets/main/index.e6d95.js', 'utf8');
// Gscene_config 模块：找 little_map_content 字段
const gi = s.indexOf('"Gscene_config"');
console.log('Gscene_config found:', gi);
// 提取 Gscene_config 定义段
const off = 0;
// 直接搜索 little_map_content 出现位置
let idx = 0, cnt = 0;
while ((idx = s.indexOf('little_map_content', idx)) >= 0 && cnt < 5) {
  console.log('\n--- little_map_content @' + idx + ' ---');
  console.log(s.slice(idx - 150, idx + 200));
  idx += 20; cnt++;
}
// 搜索 dadituMap（场景配置里的 little_map_content 值）
idx = 0; cnt = 0;
while ((idx = s.indexOf('dadituMap', idx)) >= 0 && cnt < 5) {
  console.log('\n--- dadituMap @' + idx + ' ---');
  console.log(s.slice(idx - 120, idx + 150));
  idx += 20; cnt++;
}
