import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMapDoc } from '../../src/world/mapdoc.js';
import { publishNotice, recentNotices, noticesSince, lastNoticeSeq } from '../../src/world/notices.js';
import { WorldState, type StateOpts } from '../../src/persistence/state.js';

// 临时数据目录 fixture：nav-2 / buildings / landmarks / mine-spots / portals / spawn-points
let dataDir: string;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-mapdoc-'));
  fs.mkdirSync(path.join(dataDir, 'nav'), { recursive: true });
  // 4x4 网格：kind 0=空地 1=阻挡 2=水
  // 0 1 1 0
  // 0 0 0 0
  // 2 2 0 0
  // 0 0 0 0
  const kind = [0, 1, 1, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0];
  fs.writeFileSync(path.join(dataDir, 'nav/nav-2.json'), JSON.stringify({ scene: 2, width: 4, height: 4, kind, roadNames: { 1: '主干道' } }));
  fs.writeFileSync(path.join(dataDir, 'buildings.json'), JSON.stringify({ village: [{ id: 'trade-hall', name: '交易大厅', door: { x: 8150, y: 8050 } }] }));
  fs.writeFileSync(path.join(dataDir, 'landmarks.json'), JSON.stringify([{ id: 'gate', name: '主角家门楼', x: 15, y: 16 }]));
  fs.writeFileSync(path.join(dataDir, 'mine-spots.json'), JSON.stringify([{ gx: 30, gy: 40 }]));
  fs.writeFileSync(path.join(dataDir, 'nav/portals.json'), JSON.stringify([{ scene: 1, toScene: 2, x: 1545, y: 65 }]));
  fs.writeFileSync(path.join(dataDir, 'spawn-points.json'), JSON.stringify({ scene: 2, houses: [{ id: 2, type: 'shugenjia', door: { x: 6500, y: 5300 }, rect: { x: 0, y: 0, w: 1, h: 1 } }] }));
});

function mkState(): WorldState {
  return new WorldState({ savesDir: '/tmp/x', seedFile: '/tmp/x/s.json', slot: 1, farmLeft: 0, spawns: null, growDayMs: 24 * 3600 * 1000, init: false, noPersist: true } as StateOpts);
}

describe('H 包：全村文本地图（mapdoc）', () => {
  it('生成含坐标约定/不可通行区/建筑/地标/矿点/门户/示例的完整文本', () => {
    const doc = buildMapDoc({ dataDir, sceneWidth: 4, sceneHeight: 4, cellPx: 100 });
    expect(doc.text).toContain('# 全村文本地图');
    expect(doc.text).toContain('网格 4 x 4');
    expect(doc.text).toContain('阻挡簇 0 个'); // fixture 簇 2 格 < 4，被过滤
    expect(doc.text).toContain('交易大厅');
    expect(doc.text).toContain('主角家门楼');
    expect(doc.text).toContain('矿');
    expect(doc.text).toContain('场景1 -> 场景2');
    expect(doc.text).toContain('shugenjia');
    expect(doc.text).toContain('视觉（截图）仅开发验收用');
    expect(doc.roadCount).toBe(1);
  });

  it('连通分量簇：n>=4 才保留（小散点过滤）', () => {
    const doc = buildMapDoc({ dataDir, sceneWidth: 4, sceneHeight: 4, cellPx: 100 });
    // fixture：阻挡 2 格 < 4 -> 过滤；水 2 格 < 4 -> 过滤
    expect(doc.blockedClusters.length).toBe(0);
    expect(doc.waterClusters.length).toBe(0);
  });
});

describe('H 包：公告通道（notices）', () => {
  it('发布 -> 最近 -> since 增量 -> 环形上限', () => {
    const ws = mkState();
    publishNotice(ws, 1, 'festival', '丰收节开赛');
    publishNotice(ws, 2, 'storm', '风暴预警：东田');
    publishNotice(ws, 3, 'lease', '租约释放：p1');
    expect(lastNoticeSeq(ws)).toBe(3);
    const recent = recentNotices(ws, 2);
    expect(recent.length).toBe(2);
    expect(recent[0].text).toBe('租约释放：p1');
    const inc = noticesSince(ws, 1);
    expect(inc.map(n => n.seq)).toEqual([2, 3]);
  });

  it('环形 100 条：旧公告被挤掉（since 增量按时间正序）', () => {
    const ws = mkState();
    for (let i = 1; i <= 105; i++) publishNotice(ws, i, 'system', `公告${i}`);
    expect(lastNoticeSeq(ws)).toBe(105);
    const all = noticesSince(ws, 0);
    expect(all.length).toBe(100);
    expect(all[0].seq).toBe(6); // 1-5 被挤掉，最旧保留 6
    expect(all[all.length - 1].seq).toBe(105); // 最新在末尾
  });

  it('observe.notices 联动（recentNotices 5 条）', () => {
    const ws = mkState();
    for (let i = 1; i <= 7; i++) publishNotice(ws, i, 'system', `公告${i}`);
    const recent = recentNotices(ws, 5);
    expect(recent.length).toBe(5);
    expect(recent[0].seq).toBe(7);
  });
});
