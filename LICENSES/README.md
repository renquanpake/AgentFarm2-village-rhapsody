# 第三方资产许可与署名（C9 CC0 直采，design M5b.5）

> 本目录登记 AgentFarm2 使用的外部素材来源、许可与署名。生成类资产（C8）不在此列（自有产出，CC0 声明见 repo CC0.md）。

## CC0（无署名要求，可自由使用/修改/商用）

| 来源 | 包 | 用途 | 下载 |
|------|----|------|------|
| Kenney (CC0) | Tiny Farm | 家具/动物/天气 首批 60 件 | kenney.nl/assets（Tiny Farm） |
| Kenney (CC0) | Tiny Town | 建筑/街道 补充 | kenney.nl/assets（Tiny Town） |
| Kenney (CC0) | Particle Pack | 粒子/天气特效 | kenney.nl/assets（Particle Pack） |
| 0x72 (CC0) | 动物补充集 | 动物 sprite 补充 | opengameart.org（0x72） |

下载后放入 `assets/cc0/`（本仓库生成资产目录），并在 `data/decor.json` 对应条目 `artRef` 字段指向该文件。

## CC BY（需署名）

| 来源 | 包 | 用途 | 署名要求 |
|------|----|------|----------|
| Game-icons.net | 图标集 | UI 图标 | 在 设置/关于 面板署 "icons: game-icons.net (CC BY 4.0)" |

> 游戏内署名落点：客户端"关于"弹窗（mod 层注入，不改原版外壳）。

## 直采优先级（C8 失败 3 次后）

1. Kenney CC0 对应类别
2. 0x72 CC0
3. Game-icons（图标类，CC BY 需署名）
仍无匹配 -> 退回生图 + 提示词库迭代（不引入付费/非标许可资产）。
