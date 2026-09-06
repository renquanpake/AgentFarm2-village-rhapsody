import json, sys
sys.stdout.reconfigure(encoding='utf-8')
d = json.load(open(r'D:\agent社区\AgentFarm\client\public\maps\daditu.json', encoding='utf-8'))
W, H = d['width'], d['height']
layers = {l['name']: l['data'] for l in d['layers']}

# 房型 tileset gid 区间（从 tilesets 列表）
houses = {
    'gffanzi(姑父家)': (9, 98), 'shibojias(家石伯家)': (130, 193), 'shugenjia(树根家)': (194, 283),
    'niupengsd(牛棚)': (284, 339), 'xiaomaibu(小卖部)': (352, 451), 'chunzhangjia(村长家)': (452, 659),
    'mujiangfangzi(木匠家)': (668, 757), 'mucai(木材)': (758, 763), 'laotaiaifz(老太太家)': (764, 826),
    'tufufzi(屠夫家)': (904, 984), 'zhushe(猪舍)': (1001, None),
}
fanzi = layers.get('fanzi', [])
def rect_of(gid_lo, gid_hi):
    xs, ys = [], []
    for y in range(H):
        for x in range(W):
            g = fanzi[y*W+x]
            if g >= gid_lo and (gid_hi is None or g <= gid_hi):
                xs.append(x); ys.append(y)
    if not xs: return None
    return (min(xs), min(ys), max(xs), max(ys))
for name, (lo, hi) in houses.items():
    r = rect_of(lo, hi)
    print(f'{name}: gid {lo}-{hi} rect={r}')

# 找到主角家门口通道路径（门口到村入口方向）附近的地形：先看村中心
print()
print('=== 村中心 (35..42, 28..35) 地面层抽样 ===')
diji = layers['diji']
for y in range(28, 36):
    print(' '.join(f'{diji[y*W+x]}' for x in range(35, 43)))
