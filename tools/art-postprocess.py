#!/usr/bin/env python3
# tools/art-postprocess.py —— C7 确定性后处理链（design M5b.3）：
# 最近邻缩放 -> 调色板量化（强制映射锚定 16 色）-> 透明背景抠除 -> 网格对齐校验
# 用法：python3 tools/art-postprocess.py in.png out.png [--size 32] [--palette tools/art-prompts/palette-v1.json] [--no-bg-strip]
# 把"生图随机性"压到人工修整量可控：输出保证色数 <= 调色板+1(透明)，边缘无抗锯齿灰。
import argparse, json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_palette(path):
    with open(path) as f:
        d = json.load(f)
    return [tuple(x['rgb']) for x in d['palette']]

def quantize(im, palette):
    # 每像素 -> 调色板最近色（曼哈顿距离；确定性，无随机）
    w, h = im.size
    out = Image.new('RGBA', (w, h))
    px = out.load()
    src = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
                continue
            best, bd = palette[0], 1 << 30
            for pc in palette:
                d = abs(r - pc[0]) + abs(g - pc[1]) + abs(b - pc[2])
                if d < bd:
                    bd, best = d, pc
            px[x, y] = (best[0], best[1], best[2], 255)
    return out

def strip_white_bg(im, thr=250):
    # 纯白底策略（v2）：与图像边界连通的近白像素 -> 全透明。
    # thr=250：调色板最浅色 #fadec9 (250,222,201) min=201 < 250，物体内近白（白花瓣等）不误伤。
    from collections import deque
    w, h = im.size
    px = im.load()
    def iswhite(x, y):
        r, g, b, a = px[x, y]
        return a >= 128 and r >= thr and g >= thr and b >= thr
    mask = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if iswhite(x, y):
                mask[y][x] = True; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if iswhite(x, y) and not mask[y][x]:
                mask[y][x] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not mask[ny][nx] and iswhite(nx, ny):
                mask[ny][nx] = True; q.append((nx, ny))
    return im

def strip_bg(im, threshold=32):
    # 抠除四角扩散的"背景色"（生图常带近色底）：从四角 BFS，容差内且与角色近的全透明
    w, h = im.size
    if w < 4 or h < 4:
        return im
    px = im.load()
    corner = px[0, 0]
    if corner[3] < 128:
        return im  # 已透明背景
    mask = [[False] * w for _ in range(h)]
    from collections import deque
    q = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or mask[y][x]:
            continue
        r, g, b, a = px[x, y]
        if a < 128:
            mask[y][x] = True
            continue
        if abs(r - corner[0]) + abs(g - corner[1]) + abs(b - corner[2]) <= threshold:
            px[x, y] = (0, 0, 0, 0)
            mask[y][x] = True
            q += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return im

def grid_align_report(im, cell=4):
    # 网格对齐校验：主体包围盒是否 cell 对齐
    bb = im.getbbox()
    if not bb:
        return {'aligned': None, 'bbox': None}
    x0, y0, x1, y1 = bb
    return {
        'aligned': x0 % cell == 0 and y0 % cell == 0,
        'bbox': list(bb),
        'offset': [x0 % cell, y0 % cell],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('infile', metavar='in')
    ap.add_argument('out')
    ap.add_argument('--size', type=int, default=0, help='目标最大边（0=不缩放）')
    ap.add_argument('--w', type=int, default=0, help='目标宽（优先于 --size；与 --h 配合做非方形）')
    ap.add_argument('--h', type=int, default=0, help='目标高（配合 --w）')
    ap.add_argument('--palette', default=os.path.join(ROOT, 'tools', 'art-prompts', 'palette-v1.json'))
    ap.add_argument('--no-bg-strip', action='store_true')
    ap.add_argument('--white-bg', action='store_true', help='v2 策略：与边界连通的近白像素(>=250)转透明（配合"纯白底"生图提示词）')
    args = ap.parse_args()

    im = Image.open(args.infile).convert('RGBA')
    if args.w > 0 and args.h > 0:
        if im.width != args.w or im.height != args.h:
            im = im.resize((args.w, args.h), Image.NEAREST)
    elif args.size and max(im.size) > args.size:
        scale = args.size / max(im.size)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.NEAREST)  # 最近邻（像素风）
    if args.white_bg:
        im = strip_white_bg(im)
    palette = load_palette(args.palette)
    im = quantize(im, palette)
    if not args.no_bg_strip:
        im = strip_bg(im)
    rep = grid_align_report(im)
    im.save(args.out, 'PNG')
    # 输出自检报告（JSON 附行到 stdout）
    n_colors = len({c[:3] for c in im.getdata() if c[3] >= 128})
    print(json.dumps({
        'out': args.out, 'size': im.size, 'palette_colors': len(palette),
        'result_colors': n_colors, 'grid': rep,
        'ok': n_colors <= len(palette) + 1,
    }))
    if n_colors > len(palette) + 1:
        print('WARN: 色数超出调色板（量化残留），建议人工修整或退回重生成', file=sys.stderr)
        sys.exit(2)

if __name__ == '__main__':
    main()
