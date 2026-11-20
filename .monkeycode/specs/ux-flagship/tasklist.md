# 任务清单：旗舰体验优化（ux-flagship）

> 依据 `plan.md`（六支柱 19 项）+ `ui-world.md`（V/W 系列规范）。状态来源：项目记忆与 dated 批次记录；「待核」= 无直接证据，留后续会话逐项核。2026-11-20 全盘审计补齐（P1-4）。`plan.md` 保留原任务总纲，本文件承载逐条对账状态。

## 支柱 A 零门槛上手
- [~] U1 出生引导环（onboarding 数据层「第一小时 10 环」已收口，引导环粒度未单验）
- [ ] U2 新手任务链 3 条（等经济解冻 M-B1，先上任务本体挂 0 奖励）
- [ ] U3 帮助面板（纯静态 DOM，0 依赖可穿插，未开工）

## 支柱 B 空间与导航
- [ ] U4 POI 图鉴面板（landmarks/schedule 数据现成，面板未开工）
- [ ] U5 大地图面板（daditu 路网缩略，规划定 P2 可选）
- [ ] U6 驿站快传（等市政驿站 + M-B1 解冻）
- [x] U7 小地图旗舰化（afMapRoads/Landmarks 双覆盖层 + 图层三态开关，P1b f95bec6）

## 支柱 C 反馈与质感
- [x] U8 交易反馈包（toast/dialog 统一件 M2 收口 + 飘字实测 floatCount=15 + coin sfx 随 M5）
- [ ] U9 行动气泡规范（未开工）
- [ ] U10 空态与错误文案（依赖 trade-hall R5，未开工）

## 支柱 D 世界活着
- [~] U11 昼夜氛围（M4 氛围件已收口；原版 bgm 接管点核实属半天项）
- [~] U12 NPC 日程可见化（schedule 数据现成，名牌渲染原版接管点未核）
- [ ] U13 村里八卦 ticker（gossip 数据现成，ticker 未开工）
- [~] U14 天气预警（calendar 数据现成，预警 UI 未核）

## 支柱 E 信息架构与设置
- [~] U15 设置面板（音频音量设置随 M5 已收口；图层/名牌/性能档三组未核）
- [~] U16 HUD 今日卡（TR 历法 + /af/calendar hour 字段已接线，卡片文案未核）

## 支柱 F Agent 体验
- [~] UA1 世界说明书（persona/rules-prompt 已就位，结构化概览推送未核）
- [~] UA2 observe 处境一句话（市政 L3 nearest 地标方位已就位，整句输出未核）
- [x] UA3 move_to 体验（返回路名摘要 + arrive 确认，P1b roadOf/move_to road 字段）

> 对账钩子：双金路径验收（玩家 10 分钟 / Agent 30 分钟）见 plan.md §4，当前未跑。