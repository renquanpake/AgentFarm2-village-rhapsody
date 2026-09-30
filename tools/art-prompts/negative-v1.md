# 负面提示词清单 v1（防渐变/防模糊/防抗锯齿）

> 版本 v1 · 与 style-v1.md / palette-v1.json 配套

## 必须包含的负面词
- smooth gradient, anti-aliasing, soft edges, blur, out of focus
- photorealistic, 3d render, cartoon cel shading, vector art
- text, watermark, border, frame, logo, signature
- noise, dithering artifacts, jpeg artifacts
- inconsistent palette, extra colors outside palette, rainbow colors

## 生成后自检（C7 后处理前人工快检）
1. 放大 400% 看是否有 1px 抗锯齿灰边（有 -> 退回量化步骤）
2. 色数是否 <= 调色板 + 2（超出 -> 调色冲突，退回量化）
3. 透明背景是否干净（灰底 -> 抠除步骤重跑）
4. 网格对齐：主体是否落在 4x4 对齐格（错位 -> 重新放置）

连续 3 次送审冲突（调色/网格）-> 该资产改 CC0 直采（C9），不再生图。
