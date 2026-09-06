# -*- coding: utf-8 -*-
"""对 tileset 的每个格子里, 统计"落在指定主色板之外"的像素占比, 用于判断是否含非地面/非路面物体。
用法: python _obj_detect.py <tileset名> <主色板: 如 stone/green/gray> [gid范围可选]
输出每格: 主色占比 / 异常色像素占比 / 异常色平均色(越饱和越可能是物件)。
"""
import os, json, sys
from PIL import Image
from collections import Counter

BASE = r'D:\agent社区\AgentFarm\client\public\maps\daditu'
JSON = r'D:\agent社区\AgentFarm\client\public\maps\daditu.json'

PALETTES = {
  # 名称: 判定为"该主色"的像素应满足的条件(近似方形在RGB)
  'stone': lambda r,g,b: abs(r-g) < 28 and abs(g-b) < 28 and r > 90,   # 灰白
  'green': lambda r,g,b: g > r and g > b and g > 55,                    # 绿/黄绿(草地)
  'tan':   lambda r,g,b: r > g > b and r > 150,                          # 黄褐/沙
  'blue':  lambda r,g,b: b > r and b > g and b > 110,                    # 蓝/水
  'dark':  lambda r,g,b: r < 60 and g < 60 and b < 60,                   # 深色/黑
}

def is_grayish(r,g,b):
    return abs(r-g) < 28 and abs(g-b) < 28 and r > 90

def analyze(name, palette_label):
    ts = next(t for t in json.load(open(JSON, encoding='utf-8'))['tilesets'] if t['name']==name)
    img = Image.open(os.path.join(BASE, os.path.basename(ts['image'])))
    tw, th = ts['tilewidth'], ts['tileheight']
    cols = ts['columns']; rows = ts['imageheight']//th
    pred = PALETTES[palette_label]
    idx = 0
    print(f'\n== {name} 主色板判定: {palette_label} ==')
    for r in range(rows):
        for c in range(cols):
            crop = img.crop((c*tw, r*th, c*tw+tw, r*th+th)).convert('RGB')
            n = tw*th
            cnt = Counter(crop.getdata())
            main = sum(v for (rr,gg,bb),v in cnt.items() if pred(rr,gg,bb))
            # 异常像素 = 明显非主色板且非黑边
            other = []
            for (rr,gg,bb),v in cnt.items():
                if not pred(rr,gg,bb) and not is_grayish(rr,gg,bb) and not (rr<40 and gg<40 and bb<40):
                    other.append((v,(rr,gg,bb)))
            ow = sum(v for v,_ in other)
            otop = ' '.join(f'#{rr},{gg},{bb}({v})' for v,(rr,gg,bb) in sorted(other, reverse=True)[:4]) or 'none'
            print(f'  {name}#{idx+1} gid{ts["firstgid"]+idx}: 主色占{100*main/n:.0f}%, 疏离色占{100*ow/n:.1f}% [{otop}]')
            idx += 1

if __name__ == '__main__':
    # 参数: name palette
    for pair in sys.argv[1:]:
        n, p = pair.split(':')
        analyze(n, p)
