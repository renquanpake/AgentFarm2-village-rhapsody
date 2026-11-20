# 任务清单：旗舰版视觉美化（flagship-visual-polish）

> 依据 `requirements.md`（R1-R10）+ `design.md`（里程碑 M1-M5）。状态来源：项目记忆施工进度节 + requirements R6/R7 头部「实机验收待用户」。2026-11-20 全盘审计补齐（P1-4）。

- [x] M1 设计系统（R1）：tokens.css + 全面板重皮肤 + ui-lint 门
- [x] M2 HUD 层级（R2/R3）：四分区 HUD + toast/dialog 统一（af-ui/kit.js）
- [x] M3 动效粒子（R4/R5）：三态反馈 + stagger + canvas 粒子层（af-fx/particles.js）
- [x] M4 氛围注入（R6/R7）代码侧：tint/LUT/光晕/角色反馈/开局运镜（af-fx/atmosphere.js）
- [ ] M4/M5 实机验收：新环截图 / 建筑 z 层 / 生图画风 3 锚点留用户
- [x] M5 音频包（R8）：BGM/SFX + 音量设置面板（af-audio/audio.js）+ 日历驱动接线 `/af/calendar hour` 字段
- [~] R9 原版外壳保护（常设门禁）：`hash-manifest --check` 5138 文件零变更，CI 门5 持续生效（基线数 2026-11-20 复核）
- [~] R10 性能预算（常设门禁）：ui-lint 三项常驻 DOM ≤10，CI 门8 持续生效