# 地图扩展 + 生图建筑 设计书（可执行）

Feature Name: world-expansion
Updated: 2026-09-30（决策记录：2026-09-30 用户拍板——扩展按 +28 环 189×173 做，提前到 P1；房子外观用 art-gen 生成贴图，做出"像那类建筑"的样子）
前置：`feasibility.md`（同目录，风险矩阵/研究结论）、`.monkeycode/specs/trade-hall/`

## 1. 坐标体系方案（零迁移，关键决策）

**不重排现有数据**。新网格定义为带负区：

- 旧 133×117 网格保持编号 0..132 / 0..116 不动（collision/water/house rect/decor px/portal 像素全部零改）。
- 新环 = 西 x∈[-28,0)、东 x∈[133,160)、北 y∈[-28,0)、南 y∈[117,144)。
- 数组索引：`idx(x,y) = (y+28) * 189 + (x+28)`，新数组 189×173，旧 133×117 原样拷入中间。
- px 映射统一公式（含负坐标）：`px = gx*100+50`（pnlTiledMap 本地坐标，x 可为负 / 可超 13300——Cocos 节点坐标无界，TiledMap 组件查表越界返回 0 即可）。

| 改动面 | 量 |
|---|---|
| `village-farm.json` water 数组 15561→32697（旧值居中拷贝 + 新环 0/1 设计值） | 数据文件 1 个 |
| `village-collision.json` 同法扩展 | 数据文件 1 个 |
| `gen-nav` / `build-scene-collisions` / `nav-replay` / `e2e-nav-arrive` | 加 `--offset 28` 参数（内部索引平移），旧例全回归 |
| 服务端 navOf / snapInteraction / A* | 网格类支持 origin 偏移（1 个类改 + 单测） |
| mod `injectBlockers` / 小地图 mapgrid | 数组索引偏移 + 新环绘制分支 |
| mod `ENTRY_SHIFT=2800` / 入口对齐 | **不动**（那是对齐原版 prefab 入口的既有逻辑，与网格无关） |
| 玩家存档 / 事件溯源 / 观察快照 | **不动**（px 世界坐标不变，负 px 是 Cocos 合法坐标） |

## 2. 新环地形设计（189×173，每环 28 格）

| 方位 | 内容 | 数据 |
|---|---|---|
| 西环 | 果园（可放置 decor plant 类）+ 果农宅（新增宅基地，house id 9+） | water=0，collision 新增 1 处 8×8 建筑块 |
| 南环 | 新河湾（shuich 水系接东河）+ 钓点 2 处（4 jitishuitian 门户联动） | water 设计 3 条水道 |
| 东环 | 新建筑街（本次生图建筑落位：健身房/铁匠/阶段门牌）+ 集市外摊区 | collision 新增 3 处建筑块 + 广场空地 |
| 北环 | 树林 + 气象台小塔（P0-2 落位从"村东山坡"移到北环，视线开阔） | 树丛 collision 区 + 1 小建筑块 |

渲染：新环地形 = **克隆 TMX 末 28 格（西/南/东/北四条 sibling Sprite）+ art-gen 变体 4-6 张**（果田/河湾岸线/建筑街地面/树林，style-v2 铁律），拼在 pnlTiledMap 坐标负区/超界区。

## 3. 生图建筑规格（art-gen，本设计核心）

### 3.1 原则：图不带字，字是运行时的

生图模型渲染中文不可控 → 建筑招牌区**留空**（prompt 要求"blank wooden sign board, no text, no symbols"），mod 层用 `cc.Label`（"银行""健身房"）叠加在招牌格中心（Sprite+Label 双节点，位置数据在 buildings.json）。这样换名/改风格零重画。

### 3.2 两类建筑，两条路

| 模式 | 适用 | 做法 | 新 art |
|---|---|---|---|
| A 挂牌（轻） | 中央空房 C1（交易大厅）/ 102 银行 / 109 邮局：原版已有建筑 sprite | mod 反射在原版建筑节点上加 招牌/横幅/灯笼 三件小 Sprite（art-gen 3 件小图 32×32） | 3 件小图 |
| B 覆盖（重） | +28 环新楼（健身房/铁匠/舞台）：空地无原版建筑 | art-gen 整栋建筑正视图（含屋顶/门/空招牌/阴影）， Sprite 覆盖在地面格上；zIndex 在角色层之下、地面之上 | 3 栋 |

### 3.3 生图 prompt 模板（style-v2 铁律 + 建筑条目）

```
manifest queue 新增 6 件（id 300-305，category=building）：
300 健身房（东环）: "Pixel art cozy village GYM house for 16-bit top-down pixel farm game,
    two-storey wooden building with red-tiled roof, big front door, dumbbell icon carved
    on a BLANK wooden sign board above door (no text, no letters, no symbols on the sign),
    single consistent 16-color palette: {palette-v1 复用}, 1px dark-brown outline,
    top-left highlight, clean silhouette, single building centered,
    absolute flat solid PURE WHITE background #FFFFFF ..."
301 铁匠铺: ...anvil, chimney smoke puff, FORGE sign board blank...
302 宴会舞台: ...open-air village festival stage with wooden platform, two lantern posts, banner...
303 气象台小塔: ...small round observation tower with telescope slit, weathervane...
304 招牌挂件: 32x32 wooden hanging sign + red lantern + banner 三合一素材（A 模式用）
305 街道装饰: 路牌/木桶/路灯 小件（建筑街点缀）
尺寸：建筑 288x384（3 格宽×~4 格高），后处理 resize+16 色量化（quantization 大图为
已知弱点 → 先 1 件试产人审，再批量）；小件 32x32/64x64。
art-qa 增建筑规则：宽高比 3:4±0.2 / 非白底率 / 1px 描边 / 16 色内。
```

产物路径沿用：`assets/generated/{id}-{name}.png` + manifest status done + `/af/art/{id}.png` 端点现成服务。

### 3.4 mod 摆放（Cocos 反射）

- 建筑 Sprite：`pnlTiledMap.addChild`，本地坐标 `(gx*100+50, (H-gy)*100-50)`（TMX y 翻转公式见 agentfarm.js:901），`Sprite.SizeMode.CUSTOM`，锚点(0,1)。
- 文字 Label：cc.Label 12px 金色描边，挂在招牌格（buildings.json `sign:{gx,gy}`）。
- 图层：建筑 body < 角色层 < 招牌/灯笼（zIndex 三段，数值在 spike 里对照原版建筑 z 确定）。
- 夜晚：AFATMO 给建筑打暖光（复用 M4 灯笼光晕）。

## 4. 建筑功能层（沿用 feasibility v2 菜单，落位更新）

| 建筑 | 落位 | 功能钩子 |
|---|---|---|
| 交易大厅 | 中央 C1（A 挂牌） | trade-hall spec T1-T4（move_to near / 小地图 / 行情牌） |
| 银行 | 102 gfujia（A 挂牌） | 存取计息（feeMultiplier 反向）+ Agent 资产日报 |
| 邮局 | 109 laott（A 挂牌） | letter 表 + /af/letter + Agent 写信（llm-write） |
| 气象台 | 北环小塔（B 覆盖） | 明日天气预告 + 投保 |
| 宴会厅 | 村中央广场（B 覆盖 302 舞台） | 四类节日赛事锚点 + 开摊区 |
| 健身房 | 东环新楼（B 覆盖） | attributeData 训练 + 冷却 |
| 铁匠铺 | 东环新楼（B 覆盖） | 强化/耐久（makeData） |

统一收敛到 `data/buildings.json`（trade-hall.json 并入）：
`[{id,name,kind,scene,rect,door,poi,sign,artId,mode:'hang'|'cover',hooks:[...]}]`。

## 5. NPC 对话（P0，独立小项，见 feasibility §2.0-A）

npcs.json + persona 字段（agnes 批量 26 名）→ `act talk` LLM 三段式（flagship/缓存/回落价目表）。

## 6. 排期（决策后新版）

| 序 | 任务 | 预估 | 出口门 |
|---|---|---|---|
| 1 | 相机/边界 spike + 建筑 z 层对照（probe-camera-clamp） | 1 天 | 结论进本文档 |
| 2 | 生图试产：300 健身房 1 件全流程（gen→postprocess→art-qa→mod 摆放截图） | 1 天 | 人审定画风 |
| 3 | 网格偏移工具链（gen-nav/nav-replay/A* 偏移参数 + 单测） | 1 天 | 旧 210 例全回归 |
| 4 | 新环数据（farm/collision 189×173 + 4 方位地形设计 + 新宅基地/建筑块） | 1 天 | build-scene-collisions --check + render PNG 目审 |
| 5 | 生图批量 301-305 + art-qa + 授权登记 | 1-2 天（含 429 退避） | art-qa 6/6 |
| 6 | mod：克隆贴片 + 建筑 B 覆盖 + 招牌 Label + 阻挡盒新环 + 小地图 189×173 | 2 天 | ui-smoke 不回落 + 实机截图 |
| 7 | 建筑功能 A 挂牌三座（交易大厅/银行/邮局）+ buildings.json + observe regions + move_to near | 2-3 天 | 各 e2e 1 例 + 八道门 |
| 8 | NPC 对话三段式 + persona 文案 | 1 天 | ws-test + 无 Key 回落实测 |
| 9 | 北环气象台 / 东环健身房 / 铁匠 / 中央舞台（功能+视觉） | 各 0.5-1 天 | 同上 |
| 10 | nav-replay 全量（新增 189×173 网格 210 例 + 建筑 POI 例）+ 全回归 + 提交推送 | 0.5 天 | 八道门绿 |

合计 ≈ 12-14 天（主模型规划验收 + agnes 执行件委托 + 用户实机确认 3 个锚点：新环截图 / 建筑 z 层 / 生图画风）。

## 7. 风险（本设计特化）

| 风险 | 对策 |
|---|---|
| 大图 16 色量化糊掉细节（建筑 288×384） | 序 2 单件试产人审先行；不行则降分辨率（192×256）或 32 色档（palette 扩展需 art-qa 同步） |
| 克隆贴片接缝 | 混合方案（内 12 格克隆 + 外 16 格 art-gen）+ 4 角去重 |
| 负坐标 px 与原版 Cocos 某处隐式假设冲突（如 minimap 映射、相机 limit） | 序 1 spike 全量打印验证 + 兜底：人类移动限时区内，Agent 权威移动全通 |
| 生图建筑风格漂移（7 件 7 种脸） | 统一 prompt 前缀 + 同一 16 色 palette + art-qa 机审 + 人审门 |
