# -*- coding: utf-8 -*-
"""对指定 tileset 的每个 100x100 格子输出颜色统计, 用作视觉识别的交叉验证。
用法: python _pixel_check.py <tileset名...>  (从 _tile_split 同款 meta 解析)
输出每个格子的 平均色 / 主色 / 颜色多样性(唯一颜色数/简单度)。"""
import os, json, sys
from PIL import Image
from collections import Counter

BASE = r'D:\agent社区\AgentFarm\client\public\maps\daditu'
JSON = r'D:\agent社区\AgentFarm\client\public\maps\daditu.json'

targets = sys.argv[1:] if len(sys.argv) > 1 else ['di1','cdi','shilu','shilu2','shuic','ggbangs']

def load_meta():
    all_ts = {}
    for ts in json.load(open(JSON, encoding='utf-8'))['tilesets']:
        all_ts[ts['name']] = ts
    return all_ts

def tile_colors(img):
    colors = list(img.convert('RGB').getdata())
    n = len(colors)
    uniq = len(set(colors))
    mc = Counter(colors).most_common(5)
    avg = tuple(round(sum(c[i] for c in colors)/n) for i in range(3))
    return uniq, avg, mc

def main():
    all_ts = load_meta()
    for name in targets:
        if name not in all_ts:
            print(f'!! no tileset {name}')
            continue
        ts = all_ts[name]
        img = Image.open(os.path.join(BASE, os.path.basename(ts['image'])))
        tw, th = ts['tilewidth'], ts['tileheight']
        cols = ts['columns']
        imgw, imgh = ts['imagewidth'], ts['imageheight']
        rows = imgh // th
        print(f'\n== {name} (firstgid {ts["firstgid"]}, {ts["tilecount"]} tiles) ==')
        idx = 0
        for r in range(rows):
            for c in range(cols):
                crop = img.crop((c*tw, r*th, c*tw+tw, r*th+th))
                uniq, avg, mc = tile_colors(crop)
                top = ' '.join(f'#{r},{g},{b}({n})' for (r,g,b),n in mc[:4])
                flg = 'UNIFORM' if uniq < 60 else 'varied'
                print(f'  {name}#{idx+1} gid{ts["firstgid"]+idx}: avg={avg} uniq={uniq} [{flg}] top: {top}')
                idx += 1

if __name__ == '__main__':
    main()
