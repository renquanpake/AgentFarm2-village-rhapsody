import json, sys
sys.stdout.reconfigure(encoding='utf-8')
d = json.load(open(r'D:\agent社区\AgentFarm\client\public\maps\daditu.json', encoding='utf-8'))
W, H = d['width'], d['height']
# 找地面层(diji)和树层(shuich/mulan)
def layer(name):
    for l in d['layers']:
        if l['name'] == name: return l['data']
    return None
diji = layer('diji'); shuich = layer('shuich')
def gid_at(data, x, y): return data[y*W+x]
print('=== 上边缘 y=0..2 (x=0..76 抽样每4格) ===')
for y in range(0, 3):
    row = []
    for x in range(0, W, 4):
        row.append(f'{gid_at(diji,x,y)}')
    print(f'y={y}:', ' '.join(row))
print('=== 下边缘 y=H-3..H-1 ===')
for y in range(H-3, H):
    row = []
    for x in range(0, W, 4):
        row.append(f'{gid_at(diji,x,y)}')
    print(f'y={y}:', ' '.join(row))
print('=== 左边缘 x=0..2 (y=0..60 抽样每5格) ===')
for x in range(0, 3):
    col = []
    for y in range(0, H, 5):
        col.append(f'{gid_at(diji,x,y)}')
    print(f'x={x}:', ' '.join(col))
print('=== 右边缘 x=W-3..W-1 ===')
for x in range(W-3, W):
    col = []
    for y in range(0, H, 5):
        col.append(f'{gid_at(diji,x,y)}')
    print(f'x={x}:', ' '.join(col))
# 树层在边缘的分布
print('=== shuich 树层 四角 4x4 ===')
for (x0,y0,label) in [(0,0,'TL'),(W-4,0,'TR'),(0,H-4,'BL'),(W-4,H-4,'BR')]:
    vals = [gid_at(shuich,x0+dx,y0+dy) for dy in range(4) for dx in range(4)]
    print(label, '非零数:', sum(1 for v in vals if v), 'gids:', sorted(set(v for v in vals if v)))
# tileset gid 区间: di1=1-4, cdi=5-8, gffanzi=9-98, byuand=99-101, mulan=102...
print('=== 地图四角 8x8 地面分布 (统计 diji 不同 gid) ===')
from collections import Counter
for (x0,y0,label) in [(0,0,'TL'),(W-8,0,'TR'),(0,H-8,'BL'),(W-8,H-8,'BR')]:
    c = Counter(gid_at(diji,x0+dx,y0+dy) for dy in range(8) for dx in range(8))
    print(label, dict(c))
