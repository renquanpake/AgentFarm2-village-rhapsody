# 风格描述模板 v1（AgentFarm2 原版像素风规范）

> 版本 v1 · 配套调色板 `palette-v1.json` · 每次生图必须引用版本号 + 调色板 hex 清单

## 像素密度
- 目标 sprite 尺寸：物品 16x16~32x32；家具 32x32~64x64；角色 32x48
- 1 像素 = 1 游戏 0.4 米；描边 1px；高光单点（左上 45°）

## 描边规则
- 外描边：取对象轮廓最暗邻近色，1px 宽度；不用纯黑（用 #2e1008 系）
- 内部分隔：明暗交界用同色系 -20% 明度，不加描边

## 高光位置
- 统一左上 45° 单点高光（+30% 明度），体积感物件可 2 点

## 饱和度区间
- 大地色系（#fadec9/#d29272/#b25c32）：中低饱和（40-60%）
- 植被：中等饱和（50-70%），叶色取调色板绿
- UI/点缀：高饱和单点（<=10% 画面占比）

## 生图 prompt 模板
```
Pixel art [subject], 16-bit village farm game style, single consistent
palette: {palette hex list}, 1px dark-brown outline (#2e1008), top-left
highlight, {subject detail}, transparent background, no text, no border.
Size {W}x{H}.
```

## 追溯
- 每资产产出记录：prompt 文件（tools/art-prompts/prompts/<asset>.txt）+ 调色板版本 + 生成时间 + 候选编号
- 送审：与原版同屏对比截图归档 specs/assets/（C8 流程）
