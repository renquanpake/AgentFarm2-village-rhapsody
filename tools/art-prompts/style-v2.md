# 生图策略 v2 —— 绝对纯白底 + 单体锁定（C8 返工经验，2026-09-29）

## 背景（v1 的问题）

v1 提示词写 "transparent background"，但文生图模型**做不出真透明**，实际输出纯色/米色/纹理底；
后处理 `art-postprocess.py` 的 `strip_bg`（四角同色泛洪）遇到多色底会抠不净，留下方块底色
（5 件：锦鲤池/灯笼串/极光板/香草园 米色底 + 石拱桥 整成场景）。

## v2 三条铁律（tools/art-gen.mjs `--white-bg` 自动附加）

1. **绝对纯色白底**：`absolute flat solid PURE WHITE background #FFFFFF, edge-to-edge, no gradient, no shadow`
   —— 纯白是文生图模型最稳定可控的背景；后处理"边界连通近白(>=250)转透明"必抠净。
2. **要什么生成什么（单体锁定）**：`Render EXACTLY ONE isolated asset: {name}`，负面项锁死
   `multiple objects / second object / scene / village / building / road / drop shadow`。
3. **构图**：单对象居中、占满画面主体（`centered, occupies most of the frame`）。

## 抠图（art-postprocess.py --white-bg）

- 图像 resize 后、量化前执行：与**边界连通**的近白像素（RGB 三通道 >= 250）→ 全透明。
- 阈值 250 安全：调色板最浅 `#fadec9`(250,222,201) min=201 < 250，物体内近白（白花瓣）不误伤。
- 与 `strip_bg`（四角同色泛洪）叠加：白底走 white_bg，其他底走 strip_bg 兜底。

## 定向返工流程

```bash
# 重生成指定件（无视 manifest status，直接覆盖）
node tools/art-gen.mjs --ids 210,222,231,238,259 --concurrency 1 --gap 20 --retry 5 --white-bg
```

免费档分钟级 429：concurrency 1 + gap 20s（429 退避 30s x 次数已内置）。

## 验收指标

- 外圈 3px 环：不透明主导色占比 < 40% 或整图不透明率 < 85%（非铺地类）
- 铺地/路砖/墙类（path 类目）**故意满幅**，不适用
- 色数 <= 调色板+1，4px 网格对齐（后处理自检）
