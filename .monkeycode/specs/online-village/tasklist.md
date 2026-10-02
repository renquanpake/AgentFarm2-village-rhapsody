# 施工任务清单：联机村（共享世界 · 阶段零）

Feature Name: online-village
Updated: 2026-10-02
状态图例: [ ] 未开始 | [~] 进行中 | [x] 完成 | [!] 受阻
依赖：建议在玩家审计 P0-P2 清零后开工；R2（回放确定性）为其余一切的前置。

## 工作包 A：回放确定性（R2，最高优先，其余的地基）

- [ ] A1 根因排查：重启「重放哈希 != 运行态哈希」告警（events=919 时已复现）。二分定位首个分歧事件 seq，归因到具体 apply 分支
- [ ] A2 修分歧源，重放零告警
- [ ] A3 fail-fast：哈希不一致时拒绝 slot 在线化 + `/af/replay?verify=1` 输出分歧定位
- [ ] A4 一致性校验进 CI 门（现 CI 八道门之外第九道）

## 工作包 B：私有住宅（R1）

- [ ] B1 `data/home-collision.json` 生成器：N 槽拼接 + 原版 8 房型实例化 + 门缺口 + 6 块耕地入槽
- [ ] B2 `world/homestead.ts`：槽位分配 / 偏移解析 / 越界校验；`houseSlot` 入 playerData
- [ ] B3 `ensurePlayerData` 接入分配；出生点改自家门位
- [ ] B4 gen-nav 支持 home-map（pending-source → ready，槽内局部寻路）
- [ ] B5 客户端场景 1 渲染走通（进家/出村门户）
- [ ] B6 单测 + 实机双账号验收（各自出生自家、互访被拒）

## 工作包 C：抢占原子化（R3）

- [ ] C1 `world/claims.ts` 裁决器 + 事件 `claim.won/lost`
- [ ] C2 chop / harvest / trade 吃单三处接入
- [ ] C3 `tools/stress-claims.mjs`：100 并发抢 1 树，掉落恰好 1
- [ ] C4 失败文案文案化（Agent 可读：含 holder 与资源状态）

## 工作包 D：租约与再生（R4/R5）

- [ ] D1 plot 租约字段 + 播种认领 + 照料刷新
- [ ] D2 非认领者收获 70/30 分账 + 广播
- [ ] D3 3 游戏日过期释放（挂 B8 游戏日时钟）
- [ ] D4 `world/regrow.ts` 复生队列（regrowData 桶，登记 WORLD_KEYS）
- [ ] D5 活树总量下限告警（<80% 告警日志）

## 工作包 E：灰度可观测（R6）

- [ ] E1 广播体积统计（环形缓冲 + 256KB 告警）
- [ ] E2 10 账号灰度脚本 + 体积曲线记录
- [ ] E3 分片决策备忘：体积超阈值时按 56x56 区块分片的方案要点（只记不做）

## 工作包 F：异步社交（R7）

- [ ] F1 送礼扩展 `uid@agent`（入仓 + C3 情绪事件 + 上线日记可见）
- [ ] F2 显著事件白名单 → C5 八卦 → NPC talk 素材 + A9 画报 highlights
- [ ] F3 委托栏：afTasks `delegated` 类型 + 接取/结算/破产关闭

## 收口

- [ ] G1 全量回归绿（tsc / vitest / gen-nav / nav-replay / f4 / security / 一致性第九门）
- [ ] G2 实机视觉验收（shot-client 截图判读：双开出生、住宅、共砍树）
- [ ] G3 tasklist/MEMORY 登记 + 推送
- [ ] G4 按 `docs/上线部署方案.md` 启动上线（R8）

## 里程碑门

- M-O1: 回放零告警（A 包完成即达）
- M-O2: 双账号实机「各有家、共争树」演示通过（B+C 包）
- M-O3: 10 账号灰度哈希稳定（E 包）
- M-O4: 上线链接发出（G4）
