# -*- coding: utf-8 -*-
"""把指定 tileset 的每个 100x100 格子单独裁成原尺寸图 (含放大版) 到 _tiles_single/<name>_<idx>.png
用于对不明确的格子做单格高精度识别。
用法: python _single_split.py <tileset名...>"""
import os, json, sys
from PIL import Image

BASE = r'D:\agent社区\AgentFarm\client\public\maps\daditu'
JSON = r'D:\agent社区\AgentFarm\client\public\maps\daditu.json'
OUT  = r'D:\agent社区\AgentFarm2\_tiles_single'

def main():
    os.makedirs(OUT, exist_ok=True)
    ts_map = {}
    for ts in json.load(open(JSON, encoding='utf-8'))['tilesets']:
        ts_map[ts['name']] = ts
    names = sys.argv[1:] if len(sys.argv) > 1 else ['di1','cdi']
    for name in names:
        ts = ts_map[name]
        img = Image.open(os.path.join(BASE, os.path.basename(ts['image'])))
        tw, th = ts['tilewidth'], ts['tileheight']
        cols = ts['columns']; imgw, imgh = ts['imagewidth'], ts['imageheight']
        rows = imgh // th
        idx = 0
        for r in range(rows):
            for c in range(cols):
                crop = img.crop((c*tw, r*th, c*tw+tw, r*th+th)).convert('RGB')
                big = crop.resize((300, 300), Image.NEAREST)
                o = os.path.join(OUT, f'{name}_{idx+1}_g{ts["firstgid"]+idx}.png')
                big.save(o)
                idx += 1
        print(f'{name}: {idx} singles -> {OUT}')
    print('DONE')

if __name__ == '__main__':
    main()
