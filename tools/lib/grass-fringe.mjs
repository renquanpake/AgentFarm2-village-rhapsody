// tools/lib/grass-fringe.mjs —— 草-沙羽化过渡规则（单一真实源）
//
// 背景（SPEC-VISUAL-001 §2.2）：扩展区在把 caodi 置 0（开凿道路/河道）后，底层纯黄沙地
// 瞬间裸露，形成 1px 水平刀切感。原版靠边缘羽化图块 + 翻转掩码表达草-沙互渗。
//
// 为什么要抽这个模块：expand-village-map.mjs 与 expand-village-ring.mjs 都执行「草-沙交界
// 补过渡瓦片」这件事，且 map.mjs 内部还把同一张翻转表重复写了两遍（EDGE_FLIP / FLIP）。
// 三个副本一旦各自演化就会产生视觉分叉，故收敛到此文件，两脚本共同 import。
//
// 语义：沙位于方向 d 时，用 FRINGE_BASE_GID + EDGE_FLIP[d] * D_FLIP_MASK 取过渡瓦片；
// 掩码 0x20000000 是原版 Tiled 的对角翻转位（配合方向位表达 N/S/W/E 四种羽化朝向）。
export const TRANS_GIDS = [99, 100, 101];
export const GRASS_GIDS = [5, 6, 7, 8];
export const EDGE_FLIP = { N: 3, S: 4, W: 0, E: 5 };
export const FRINGE_BASE_GID = 100;
export const D_FLIP_MASK = 0x20000000;

/** 沙在方向 d 时的羽化过渡瓦片 GID */
export function fringeGid(d) {
  return FRINGE_BASE_GID + EDGE_FLIP[d] * D_FLIP_MASK;
}

/** 是否草地瓦片 */
export function isGrassGid(g) {
  return GRASS_GIDS.includes(g);
}

/**
 * 探测 (x,y) 四周第一个「沙邻居」方向，供调用方补羽化瓦片。
 * isSand(x,y) 由调用方提供（两脚本的图层访问器不同，此处不耦合）。
 * 顺序与原实现一致：北→南→东→西。
 */
export function sandNeighborDir(isSand, x, y) {
  if (isSand(x, y - 1)) return 'N';
  if (isSand(x, y + 1)) return 'S';
  if (isSand(x + 1, y)) return 'E';
  if (isSand(x - 1, y)) return 'W';
  return null;
}
