# Requirements Document：联机村（共享世界 · 阶段零）

Feature Name: online-village
Updated: 2026-10-02
状态：规划定稿（2026-10-02 用户拍板），待实施
前置文档：`docs/最终版规划书.md`（导航闭环）、`docs/全方位旗舰进化书.md`（阶段零）、`docs/上线部署方案.md`（部署挂钩）

## Introduction

把「单进程单世界多账号」升级为可运营的多人共享村庄：村庄共享、住宅私有、去中心化内容生产、薄壳秩序（房主管人不管地）。范围覆盖：场景 1 私有住宅、世界回放确定性、抢占原子化、地块租约与树木再生、多人灰度、异步社交。

## Glossary

- **共享世界**：一个服务进程内一份世界状态（`WORLD_KEYS` 桶），全部在线玩家读写同一份
- **住宅槽位**：场景 1 中按玩家隔离的坐标区间，含住宅与 6 块耕地，他人不可达
- **租约**：公共田块自播种起至收获或过期的认领状态
- **抢占**：多个主体同时请求同一份有限资源时的裁决
- **回放哈希**：事件流重放终点与运行态的结构化哈希比对（`structuredHash`）
- **照料事件**：浇水、除虫、补种等延长租约的玩家/Agent 动作
- **文本无障碍**：一切玩家可见信息在 observe / act 结果 / 公开 GET 端点至少其一有文本通道（旗舰书 §5 契约 T1-T3）

## Requirements

### R1 私有住宅（场景 1）

**User Story:** AS 玩家，我要拥有自己的家，以便在共享村庄中有私有归属地。

#### Acceptance Criteria

1. WHEN 新账号完成注册，系统 SHALL 为该账号分配唯一住宅槽位并写入 `playerData.houseSlot`
2. WHEN 玩家首次进入游戏，系统 SHALL 将出生位置置于该玩家住宅门位
3. WHILE 玩家位于场景 1，系统 SHALL 仅呈现该玩家槽位偏移区间内的住宅内容
4. 住宅房型 SHALL 复用 `data/spawn-points.json` 中原版 8 栋房的 rect/door/treeRing 规格
5. IF 玩家请求落点位于他人槽位坐标区间，服务端 SHALL 拒绝并返回越界提示
6. WHEN 住宅分配完成，`farmData.plotDatas` 的 6 块耕地 SHALL 重定位至该玩家槽位坐标并归属本人

### R2 世界回放确定性

**User Story:** AS 运营者，我要事件重放与运行态完全一致，以便多人并发下可验收、可恢复。

#### Acceptance Criteria

1. WHEN 服务启动完成事件重放，重放终点哈希 SHALL 等于运行态结构化哈希
2. IF 重放哈希与运行态哈希不一致，服务 SHALL 拒绝该存档位进入在线态，并输出首个分歧事件的 seq
3. WHEN 任何修改世界状态的变更合入，一致性校验 SHALL 作为回归门执行

### R3 抢占原子化

**User Story:** AS 玩家，我要与他人公平竞争有限资源，以便多人互动有真实稀缺感。

#### Acceptance Criteria

1. WHEN 多个主体并发请求同一有限资源（可砍树/成熟作物/订单簿对手价），系统 SHALL 恰好裁决一个主体成功
2. IF 主体未获得资源，系统 SHALL 返回明确失败文案并说明资源当前状态
3. WHEN 100 个并发请求竞争同一棵成熟树，系统 SHALL 产出恰好一次掉落

### R4 地块租约

**User Story:** AS 玩家，我要通过播种认领公共田块，以便劳动成果获得机制保护。

#### Acceptance Criteria

1. WHEN 主体在公共田块播种，系统 SHALL 将该地块标记为认领态并记录认领者
2. WHEN 非认领者收获认领地块，系统 SHALL 按收获者 70% / 认领者 30% 分配产出并广播
3. IF 认领地块连续 3 游戏日无照料事件，系统 SHALL 自动释放租约并广播
4. WHILE 地块处于认领态，observe SHALL 输出认领者标识

### R5 树木再生

**User Story:** AS 运营者，我要树木可持续再生，以便任何 Agent 都无法砍光森林。

#### Acceptance Criteria

1. WHEN 树被砍倒，系统 SHALL 生成复生计划（2 游戏日后同格复生）
2. WHILE 复生计划未到期，该格 SHALL 保持可通行
3. WHEN 复生到期，系统 SHALL 在原格重建树木并广播 `tree.regrown`
4. 村庄活树总量 SHALL 保持高于初始总量的 80%

### R6 多人灰度

**User Story:** AS 运营者，我要在人数增长时获得可观测信号，以便决定是否分片。

#### Acceptance Criteria

1. WHEN 在线玩家从 2 增至 10，事件重放哈希 SHALL 保持稳定
2. WHEN 世界桶广播发生，系统 SHALL 记录单条消息体积指标
3. IF 单条 `save_broadcast` 体积超过 256KB，系统 SHALL 输出告警日志

### R7 异步社交

**User Story:** AS 玩家，我要在离线时我的 Agent 替我社交，以便村庄有持续的人际温度。

#### Acceptance Criteria

1. WHEN 玩家向离线玩家的 Agent 赠送物品，系统 SHALL 入账目标玩家仓库并触发其 Agent 情感事件（C3 模型）
2. WHEN Agent 产生显著行为事件（大额成交/赛事得分/租约纠纷），系统 SHALL 经 C5 八卦链写入 NPC 对话素材与画报素材
3. WHEN 玩家在委托栏发布任务，其他玩家 Agent SHALL 可接取并在完成后自动结算报酬
4. WHEN 收礼事件发生，目标玩家下次上线 SHALL 在日记中看到该事件

### R8 部署挂钩

1. WHEN R1-R7 全部验收通过，上线部署 SHALL 按 `docs/上线部署方案.md` 执行

### R9 文本无障碍契约（设计铁律，旗舰书 §5）

**User Story:** AS 纯文本 LLM Agent，我要仅凭文本通道获得全部游玩信息，以便无视觉完成整个游戏循环与自主路线规划。

#### Acceptance Criteria

1. 系统 SHALL 提供 `/af/mapdoc`：由数据文件自动生成的全村文本地图（村庄边界与坐标约定、不可通行区域、水域簇、建筑与门位、地标、矿点、主干路网、跨场景门户、自规划示例），数据变更后内容随之更新
2. WHEN 系统/村庄公告产生（节日开赛、风暴预警、租约释放等），observe SHALL 携带 notices 字段，且 `/af/notices` SHALL 可查询历史公告
3. WHEN Agent 请求任务视图，observe.tasks SHALL 输出任务清单（含系统任务与委托栏任务）
4. WHILE 节日赛进行中，observe.festival SHALL 含计分板与已开摊位列表
5. WHEN 一个真实 LLM Agent 仅使用文本通道游玩完整游戏日，全程 SHALL 无信息死点（文本盲测门 M-O4）
6. IF 任何新增功能存在玩家可见的画面信息，其实现 SHALL 同步交付文本等价通道（进 CI 表面审计清单）
