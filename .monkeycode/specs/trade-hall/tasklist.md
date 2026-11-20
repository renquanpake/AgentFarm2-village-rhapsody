# 任务清单：玩家交易区（trade-hall）

> 依据 `requirements.md`（R1-R6）+ `design.md` §实施顺序（T1-T6）。状态来源：项目记忆（P1d 批次 573d895）与 requirements 头部标注。2026-11-20 全盘审计补齐（P1-4）。

- [x] T1 数据与服务端（buildings.json 统一 7 建筑 + snapInteraction kind + observe regions + /af/mapgrid decor/buildings，573d895）
- [~] T2 mod 小地图金框/标签（图层体系 P1b 已就位，交易区专属样式待核）
- [x] T3 mod Cocos 视觉（横幅/灯笼/立牌 art-gen 出图 + injectBuildingSigns B 覆盖渲染；实机锚点同批留用户）
- [x] T4 玩家/Agent 一键到达（move_to near=buildingTargetOf 全链路 + nav-replay/e2e 例在册）
- [ ] T5（P2 可裁剪）/af/book + 行情卡片告示牌——未开工
- [ ] T6（P2 可裁剪）节日集市门前摊位——未开工

每步收尾八道门回归 + security-check 已随批次执行。