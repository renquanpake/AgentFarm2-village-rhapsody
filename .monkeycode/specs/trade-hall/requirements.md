# 玩家交易区（Trade Hall）需求文档

Feature Name: trade-hall
Updated: 2026-09-30

## 背景

村庄（scene 2）中央地带存在 3 处无 NPC 归属的空房子建筑块（碰撞数据可见：`(48,43)-(57,51)` 10x9 / `(76,50)-(85,57)` 10x8 / `(47,64)-(53,72)` 7x9，nav 133x117 网格）。玩家目前买卖靠订单簿消息 + NPC 摊位，缺少一个"看得见、找得到"的物理交易场所。本特性将其中一间空房改造为玩家交易区：

1. 游戏世界里能一眼认出（招牌/灯笼/光晕），
2. 小地图上能直接看到标记，
3. 玩家与 Agent 都能以统一语义"走到交易区"（move_to 交互环 + observe 区域说明），
4. （P2 可选）房内看行情告示牌。

前置：进化书 D3 交互环、D2 区域级 observe、M4 氛围（AFATMO）、小地图扩展版（/af/mapgrid + afMapBg）均已收口，本特性全部走 mod 演进层（client/mod/**、index.html、服务端 additive 端点），不碰 5128 文件原版哈希基线。

## 术语表

- **交易区（trade-hall）**：被选定的空房 + 门前可站立交互环。
- **nav 坐标**：133x117 网格（村景 +28 偏移）；像素 = 格×100。
- **mod 层**：client/mod/**（Cocos 反射 + DOM/CSS 注入），可演进；原版 client 文件受哈希门保护。
- **交互环**：snapInteraction（`near=` 目标类型吸附到可站立格）。

## 需求

### R1 选定房子（先决）

**用户故事**：AS 房主，I want 交易区落在中央地带一间空房上，so that 玩家/Agent 在村里走道中央就能看到它。

#### 验收标准

1. THE 系统 SHALL 在 `data/trade-hall.json`（新文件，single source of truth）登记唯一一间交易区房子，字段：`scene: 2`、`rect {x,y,w,h}`（nav 格）、`door {px,py}`（像素，门口可站格中心）、`poi {px,py}`（交互环吸附点）。
2. THE 用户 SHALL 在三个候选中确认一间（见"待确认"节）：C1 (48,43)-(57,51)、C2 (76,50)-(85,57)、C3 (47,64)-(53,72)；确认后由主模型补门位/POI 像素坐标并写入 `data/trade-hall.json`。
3. IF 候选房在实机中并非空闲（有 NPC 占用/贴图不符），THE 系统 SHALL 支持更换候选：只改 `data/trade-hall.json` 一行，无需改代码。

### R2 世界里"一眼认出"（视觉识别）

**用户故事**：AS 玩家，I want 走近村子中央就能看到一间挂了"交易区"招牌的房子，so that 我知道去哪里跟别的玩家/Agent 买卖。

#### 验收标准

1. WHEN 玩家进入村景（scene 2），THE mod 层 SHALL 在交易区房子上挂载：檐口横幅（Sprite + 程序生成或 art-gen 贴图，"交易区"三字）、门前一盏灯笼（AFATMO 夜晚增亮）、门口一块立牌（Sprite，"交易区 / 玩家订单簿"）。
2. WHILE 玩家距离交易区 <= 4 格，THE mod 层 SHALL 显示 DOM 浮层提示（"交易区：玩家在此买卖（订单簿）"，3s 自动消失，玻璃阶 token 配色）。
3. THE 视觉元素 SHALL 全部走 mod 层（Cocos 反射注入节点 + DOM 浮层），`client/original-hash.json` 5128 文件哈希零变更。
4. IF Cocos 反射读取失败（cc.director 不可用），THE mod 层 SHALL 降级为仅 DOM 提示 + 小地图标记（功能不断）。

### R3 小地图可见

**用户故事**：AS 玩家，I want 打开小地图直接看到交易区在哪，so that 不用满村找。

#### 验收标准

1. THE 服务端 `/af/mapgrid` SHALL 在响应中增 `tradeHall: { x, y, w, h }`（additive，取 data/trade-hall.json；未配置时字段缺省不出现，旧客户端零影响）。
2. WHEN mod 小地图（afMapBg）绘制村景，THE mod 层 SHALL 在交易区位置画金色描边矩形（2px，`--af-c-gold` 系 token）+ "交易区" 文字标签（字号随地图缩放，最小 10px）。
3. WHILE 交易区数据缺失（旧服务器），THE 小地图 SHALL 保持现状不报错。
4. THE 标记 SHALL 仅出现在村景（scene 2）页签，其他场景页签不画。

### R4 统一导航语义（玩家 + Agent）

**用户故事**：AS Agent/玩家，I want 一条命令"去交易区"，so that 不用自己算坐标。

#### 验收标准

1. WHEN Agent 发 `move_to {near: "trade-hall"}`（不携带 x/y），THE 服务端 SHALL 吸附到 `data/trade-hall.json` 的 POI 交互环并返回航点（复用 D1 闭环 + D3 交互环，新增 `kind: 'trade-hall'` 吸附类型：目标格须贴房子可站立侧，类似 water 的邻格规则）。
2. WHEN Agent 发 `observe`，THE 服务端 SHALL 在 `regions` 中输出"交易区（玩家订单簿/集市）：nav 格范围 (x,y,w,h)，走 door 像素 (px,py) 前可站立环下单"（区域级描述，符合 D2 原则：给区域不给逐格清单）。
3. WHEN 玩家（非托管）在小地图点击交易区标记，THE mod 层 SHALL 调用 `move_to {near:"trade-hall"}`（若玩家为托管账号）或在聊天区提示坐标（非托管兜底文案）。
4. THE 三处候选坐标、门位、POI SHALL 在 nav-replay 回放集中各加 1 例（起点=7 宅基地之一，目标=交易区 POI，验证可达 + 吸附环正确）。

### R5 行情告示牌（P2，可裁剪）

**用户故事**：AS 玩家，I want 站在交易区门口就能看到当前盘口，so that 不用打开订单簿消息。

#### 验收标准

1. THE 服务端 SHALL 新增 `GET /af/book?item=N`（additive 只读，返回 `marketView` 的 book top-5 + 最近 3 笔成交，token 鉴权同 /af/economy）。
2. WHEN 玩家位于交易区 POI 半径 6 格内，THE mod 层 SHALL 在 DOM 显示行情卡片（三件默认物品 1/2/3 的 best bid/ask + 最近成交，5s 轮询，玻璃阶样式，内存增量计入 M-B 30MB 门）。
3. IF 轮询失败，THE 卡片 SHALL 显示"行情暂不可用"并退避 15s 重试。

### R6 节日集市联动（P2，可裁剪）

**用户故事**：AS 房主，I want 节日开摊发生在交易区门前，so that 集市有固定物理锚点。

#### 验收标准

1. WHEN 节日日（`/af/calendar` festival 非空）且玩家 `act stall` 开摊成功，THE 服务端 SHALL 在广播中附交易区坐标；THE mod 层 SHALL 在交易区门前生成摊位 Sprite（AFATMO 光晕）。
2. THE 摊位 Sprite SHALL 随节日结束（次游戏日）移除。

## 待确认（主模型默认值，用户可推翻）

| 项 | 默认 | 备选 |
|---|---|---|
| 选哪间房 | C1 `(48,43)-(57,51)`（中央偏北、门口通道最宽，视觉最"广场感"） | C2 / C3 |
| R5 行情牌 | P2 做 | 裁剪掉（只用订单簿消息） |
| R6 集市联动 | P2 做 | 裁剪掉 |
| 房内内部场景 | 不动（102/109 等 interior 场景维持现状） | P3 研究 |

## 非目标

- 不改撮合引擎/订单簿/影子（D8 已收口，交易机制本身零变更）。
- 不加新物品/新 NPC/新任务线。
- 不动原版 5128 哈希基线与 afserver.mjs 冻结基线。
