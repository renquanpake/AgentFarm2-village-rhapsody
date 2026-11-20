# 任务清单：地图扩展与世界扩容（world-expansion）

> 依据 `design.md` §6 排期（10 序）+ `feasibility.md` + `roads-landmarks.md`。状态来源：dated 批次记录（d027ba9 / f95bec6 / 573d895 / abaeb5f / 23cf254）。2026-11-20 全盘审计补齐（P1-4）。

- [x] 序1 相机/边界 spike（原版钳制随 TMX 自动扩展、零代码；§6.1 已验证 2026-10-01）
- [x] 序2 生图试产 300 健身房全流程（gen→postprocess→art-qa→mod 摆放截图）
- [x] 序3 网格偏移工具链（shift-village-data 幂等 + nav-replay 旧例全回归）
- [x] 序4 新环数据 189×173（四方位地形 + 新宅基地/建筑块，build-scene-collisions --check 过）
- [x] 序5 生图批量 301-311 + art-qa 60/60 + 授权登记（C8 闭环）
- [x] 序6 mod 层（克隆贴片 + B 覆盖 + 招牌 Label + 阻挡盒新环 + 小地图 189×173）
- [x] 序7 建筑功能 A 挂牌三座（交易大厅/银行/邮局）+ buildings.json + observe regions + move_to near
- [x] 序8 NPC 对话三段式 + persona 26 名（abaeb5f）
- [x] 序9 北环气象台 / 东环健身房 / 铁匠 / 中央舞台宴会厅（23cf254）
- [x] 序10 nav-replay 全量 240×2 + 十二道门 + 推送远端
- [ ] 实机确认 3 锚点（新环截图 / 建筑 z 层 / 生图画风）——留用户
- [ ] P2 余项：daditu 大地图路网缩略渲染（可选，未排期）