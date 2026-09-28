# 施工任务清单：AgentFarm2 可玩性升级（旗舰版）

Feature Name: agentfarm2-playability-upgrade
Updated: 2026-09-28
状态图例: [ ] 未开始 | [~] 进行中 | [x] 完成 | [!] 受阻

> 恢复指引：新会话续作时，先读本文件确认进度，再按需读同目录 requirements.md（验收标准）与 design.md（技术方案）。三轨可并行，轨内任务按序。

## 轨道 A：地基（52 人日）

- [ ] A1 TypeScript 服务端重写：七模块拆分（gateway/world/market/navigation/cognition/narrative/persistence），strict 模式，zod 校验（design M6.1，26 人日中的 12）
- [ ] A2 事件溯源：events 表 + apply 纯函数 + 事件内随机种子 + 快照表（design M6.2，8 人日）
- [ ] A3 迁移与备份：migrations、WAL、每日本地备份保留 30 天（design M6.3，3 人日）
- [ ] A4 CI 六道门：typecheck/vitest/协议回归/gitleaks/原版哈希/导航回放（design M6.4，3 人日）
- [ ] A5 管理后台与结构化日志（design M6.5，… 余量）
- [ ] A6 玩家 Key 接入：AES-256-GCM 保管、子进程注入、脱敏（design M7，6 人日）
- [ ] A7 双档路由与缓存：tier_map 查表、前缀缓存、用量面板（design M7，6 人日）
- [ ] A8 导演镜头与想法气泡（design M1.1-1.2，4 人日）
- [ ] A9 画报日报：叙事服务 + 生图插画 + 回落截图（design M1.3，4 人日）
- [ ] A10 确定性回放器与回放模式渲染（design M1.4，6 人日）

## 轨道 B：玩法（50 人日）

- [ ] B1 CDA 订单簿撮合引擎 + NPC 商人做市冷启动（design M2.1，8 人日）
- [ ] B2 NPC 商人策略与跨场景采购（design M2.2，4 人日）
- [ ] B3 货币治理与通胀回收（design M2.3，3 人日）
- [ ] B4 影子模式 14 日观察与调参（design M2.4，3 人日 + 观察期）
- [ ] B5 导航数据生产：27 场景 nav-grid + 门户图 + 人工核验截图（design M3.1，4 人日）
- [ ] B6 分层寻路与航点确认协议（design M3.2-3.3，6 人日）
- [ ] B7 NPC 日程系统与节庆/天气聚集规则（design M3.4，3 人日）
- [ ] B8 历法/天气/季节（design M5a，4 人日）
- [ ] B9 畜牧 + 烹饪加工（design M5a，7 人日）
- [ ] B10 家具装饰 + 最美庭院评比（design M5a，5 人日）
- [ ] B11 节日集市与比赛玩法（design M5a，3 人日）

## 轨道 C：认知与美术（36 人日）

- [ ] C1 L2 情节记忆：memory 表 + embedding 检索 + FTS5 回落（design M4.1，5 人日）
- [ ] C2 L3 时序知识图谱：facts 表 + 抽取 + 失效修订（design M4.2，5 人日）
- [ ] C3 OCC 情感模型：8 分量 + 衰减 + 行为权重映射（design M4.3，4 人日）
- [ ] C4 目标层级与睡眠期整理（design M4.4-4.5，4 人日）
- [ ] C5 八卦传播链（design M4.6，2 人日）
- [ ] C6 风格提示词库 v1 + 调色板提取（design M5b.1，2 人日）
- [ ] C7 后处理链脚本 art-postprocess.py（design M5b.3，2 人日）
- [ ] C8 首批 60 件资产生成 + 送审归档（design M5b，10 人日）
- [ ] C9 CC0 素材直采与 LICENSES 目录（design M5b.5，2 人日）

## 收口（8 人日）

- [ ] F1 三轨联调 + 协议回归全绿
- [ ] F2 角色扮演评测集达标（含自主行为占比 >= 30%、多样性熵防退化）
- [ ] F3 导航路线回放 x10 场景矩阵通过
- [ ] F4 本地 + Tailscale 部署验收（docs/tailscale.md）

## 里程碑门

- M-A1: 事件溯源上线（事件即唯一事实源）
- M-B1: 影子市场 14 日报告达标
- M-C1: 认知评测集三指标达标
- M-Final: requirements.md 全部 EARS 条目通过

## 施工前必办

- [ ] P0 用户确认开工
- [ ] P0 用户撤销并轮换已暴露的 GitHub PAT（本次会话聊天中出现）
- [ ] P0 决定是否推送规划文档到远程仓库（当前仅本地提交）
