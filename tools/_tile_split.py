# -*- coding: utf-8 -*-
"""
_tile_split.py
将《乡村狂想曲》村地图 tileset 图集按 100x100 裁成格子, 每 4 格拼成一张 2x2 大图
(每格缩放便于观察 + 8px 黑间隔 + 编号文字), 输出到 _tiles_parts/ 按 tileset 分组。

用法:
    python _tile_split.py
本脚本从对应的 daditu.json 读取 tileset 元数据 (name/firstgid/tilecount/imagewidth/imageheight),
仅处理配置里列出的目标图集, 输出供 vision-check.py 识别。
"""
import os, json, glob
from PIL import Image, ImageDraw, ImageFont

BASE = r'D:\agent社区\AgentFarm\client\public\maps\daditu'
JSON  = r'D:\agent社区\AgentFarm\client\public\maps\daditu.json'
OUT   = r'D:\agent社区\AgentFarm2\_tiles_parts'

TILE = 100           # 原格子尺寸
CELL = 200           # 拼图里每格显示尺寸 (放大显示便于识别)
GAP  = 8             # 格子间距
FONT_H = 28          # 编号字高

# 需要处理的目标图片 (任务指定的子集)
TARGET_FILES = [
    'bjj_di1.png', 'bjj_cdi.png',
    'bjj_2_cdui.png', 'bjj_2_cdui2.png', 'bjj_2_cichis.png', 'bjj_2_cichis2.png',
    'bjj_shuic.png', 'bjj_2_mucai.png',
    'bjj_2_shilu.png', 'bjj_2_shilu2.png', 'bjj_2_shilu3.png', 'bjj_2_shilu4.png',
    'bjj_2_tanzi1.png', 'bjj_2_tanzi2.png', 'bjj_2_tanzi3.png', 'bjj_2_tanzi4.png',
    'bjj_byuand.png',
    'bjj_2_mulan.png', 'bjj_2_mulan2.png', 'bjj_2_mulan3.png', 'bjj_2_mulan4.png',
    'bjj_2_ggbangs.png', 'bjj_2_shuijingssss.png',
]

def iter_tiles(img_path, columns, tilewidth, tileheight, imagewidth, imageheight):
    """按 Tiled 行优先顺序产出 (index, gid_offset0, crop_region)。"""
    img = Image.open(img_path)
    rows = imageheight // tileheight
    cols = columns
    idx = 0
    for r in range(rows):
        for c in range(cols):
            x = c * tilewidth
            y = r * tileheight
            crop = img.crop((x, y, x + tilewidth, y + tileheight))
            yield idx, crop, (r, c)
            idx += 1

def load_font(size):
    for cand in [
        r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\arial.ttf',
        r'C:\Windows\Fonts\segoeui.ttf',
    ]:
        if os.path.exists(cand):
            try:
                return ImageFont.truetype(cand, size)
            except Exception:
                continue
    return ImageFont.load_default()

def main():
    meta = json.load(open(JSON, encoding='utf-8'))
    tilesets = {}
    for ts in meta['tilesets']:
        img = os.path.basename(ts['image'])
        if img in TARGET_FILES:
            tilesets[img] = ts
    print(f'目标 tileset 数: {len(tilesets)}')

    for img_name, ts in sorted(tilesets.items()):
        img_path = os.path.join(BASE, img_name)
        name = ts['name']
        tw = ts['tilewidth']; th = ts['tileheight']
        iw = ts['imagewidth']; ih = ts['imageheight']
        cols = ts['columns']

        tiles = list(iter_tiles(img_path, cols, tw, th, iw, ih))
        total = len(tiles)
        print(f'\n[{name}] {img_name}: {total} 个格子 (gid {ts["firstgid"]}~{ts["firstgid"]+total-1})')

        # 分组: 每 4 格一组 (2x2)
        parts = (total + 3) // 4
        font_small = load_font(FONT_H) if total else None

        for pi in range(parts):
            group = tiles[pi*4 : pi*4+4]
            canvas = Image.new('RGB',
                (CELL*2 + GAP*3, CELL*2 + GAP*3 + FONT_H*3),
                (0, 0, 0))
            draw = ImageDraw.Draw(canvas)
            for gi, (idx, crop, (r, c)) in enumerate(group):
                rr, cc = gi // 2, gi % 2
                scaled = crop.resize((CELL, CELL), Image.NEAREST)
                x = GAP + cc*(CELL+GAP)
                y = GAP + FONT_H + rr*(CELL+GAP)   # 顶部留一行给标题
                canvas.paste(scaled, (x, y))
                gid = ts['firstgid'] + idx
                lab = f'{name}#{idx+1} (gid {gid})'
                draw.rectangle([x, y+CELL, x+CELL, y+CELL+FONT_H], fill=(0,0,0))
                # 居中编号
                w = draw.textlength(lab, font=font_small)
                draw.text((x + (CELL - w)//2, y+CELL + 2), lab,
                          fill=(255,255,100), font=font_small)
            fname = os.path.join(OUT, f'{name}_part{pi+1}.png')
            canvas.save(fname)
            print(f'    -> {os.path.basename(fname)} 格子索引[{pi*4}~{min(pi*4+3,total-1)}]')

    print('\n完成。')

if __name__ == '__main__':
    main()
