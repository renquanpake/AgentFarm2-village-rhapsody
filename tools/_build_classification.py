# -*- coding: utf-8 -*-
"""依据 vision 结果 + 像素交叉验证, 生成最终的 tile 分类表
(tile-classification.json + tile-classification.md)。"""
import json, os

JSON_META = r'D:\agent社区\AgentFarm\client\public\maps\daditu.json'
OUT_JSON  = r'D:\agent社区\AgentFarm2\tools\tile-classification.json'
OUT_MD    = r'D:\agent社区\AgentFarm2\tools\tile-classification.md'

# 人工审定: 每个 tileset 每格的 category/name/safe_to_pave。
# index 为该 tileset 内 0-based 格子序号, gid = firstgid + index。
# 类别: grass|dirt|road|water|building|object|decoration|tree|house|blank|other|unknown
# 依据: 程序化像素分析(精确) + Agnes 视觉(参考)。
CLASSES = {
    'di1':    {0:('dirt','黄褐色沙地/泥土地面(纯)'),
               1:('dirt','黄褐色沙地/泥土地面(纯)'),
               2:('dirt','黄褐色沙地/泥土地面(纯)'),
               3:('dirt','黄褐色沙地/泥土地面(纯)')},
    'cdi':    {0:('grass','绿色草地(纯)'),
               1:('grass','绿色草地(纯)'),
               2:('grass','绿色草地(纯)'),
               3:('grass','绿色草地(纯)')},
    'byuand': {0:('grass','草地→黄泥土过渡(纯地面)'),
               1:('dirt','黄泥→草地过渡(纯地面)'),
               2:('dirt','黄沙/泥土(纯地面)')},
    'mulan':  {0:('object','木门/木质门体')},
    'mulan2': {0:('object','木门结构(门架)')},
    'mulan3': {0:('object','木质门/木纹墙片')},
    'mulan4': {0:('object','木质门/木纹构件')},
    'cdui':   {0:('object','干草堆边缘+稻草束'),
               1:('object','草叶/麦穗装饰(非地面)'),
               2:('object','稻草丛装饰(非地面)'),
               3:('object','稻草垛(捆扎)'),
               4:('object','陶罐/罐子局部'),
               5:('object','干草堆/草捆')},
    'cdui2':  {0:('object','干草堆顶/稻草'),
               1:('object','干草堆俯视')},
    'cichis': {0:('object','干草堆/草垛'),
               1:('decoration','木框挂画/告示牌(黄底闪电纹)')},
    'cichis2':{0:('object','木框水井/水池'),
               1:('object','木框容器内含蓝色水面(水槽/井)')},
    'shuic':  {0:('water','水岸:棕色岩壁/沙滩(临水)'),
               1:('water','水岸:草地/岩石崖壁(临水)'),
               2:('water','水岸:岩壁+蓝水面'),
               3:('water','水面+岩石岸(混合)'),
               4:('water','青绿海岸/浅滩(混合)'),
               5:('water','纯蓝色水面'),
               6:('water','草地边框内的蓝色水面/井口结构'),
               7:('water','草地与水面交界(临水岸)')},
    'mucai':  {0:('object','木板(左)'),
               1:('object','木板(右)'),
               2:('object','木板+三角木块'),
               3:('object','木板右端'),
               4:('object','堆叠木板'),
               5:('object','堆叠木板')},
    'tanzi1': {0:('object','陶罐(局部)'),
               1:('object','陶罐(局部)'),
               2:('object','陶罐(侧面)'),
               3:('object','陶罐/桶(局部)')},
    'tanzi2': {0:('blank','空白/纯白(空tile)'),
               1:('object','红盖陶罐'),
               2:('object','红盖陶罐'),
               3:('object','两个红盖陶罐叠放')},
    'tanzi3': {0:('object','陶罐(开口/边缘)'),
               1:('object','陶罐主体')},
    'tanzi4': {0:('object','一个陶罐')},
    'shuijingssss': {0:('object','陶罐/水罐(带把手)'),
                1:('object','缠绕的粗绳/绳索卷轴'),
                2:('object','绳索捆扎道具'),
                3:('object','盘绕绳索'),
                4:('building','石砌水井'),
                5:('object','木制结构'),
                6:('object','木桶(局部)'),
                7:('object','井底石板/井口装饰(深色)'),
                8:('object','暗色结构/井边配件')},
    'shilu':  {0:('road','灰色石板路/石子路'),
               1:('road','灰色石板路'),
               2:('road','灰色石板路角'),
               3:('road','灰色石板路(转角)'),
               4:('road','灰色石板路(碎石)'),
               5:('road','灰色石板路'),
               6:('road','灰色石板路'),
               7:('road','灰色石板路'),
               8:('road','灰色石板路'),
               9:('road','灰色石板路'),
               10:('road','灰色石板路'),
               11:('road','灰色石板路')},
    'shilu2': {0:('road','灰白石板路(碎石)'),
               1:('road','灰白石板路(碎石)'),
               2:('road','灰白石板路(碎石)'),
               3:('road','灰白石板路'),
               4:('road','灰白色亮石板(广场)'),
               5:('road','灰白石板路(深缝)'),
               6:('road','灰白石板路(深缝)'),
               7:('road','灰白石板路(深缝)'),
               8:('road','灰白石板路'),
               9:('road','灰白色石板(广场)'),
               10:('road','灰白石板路(碎石)'),
               11:('road','灰白石板路'),
               12:('road','灰白石板路'),
               13:('road','灰白石板路'),
               14:('road','灰白色亮石板(广场)')},
    'shilu3': {0:('road','灰色石板路边缘'),
               1:('road','灰色石板路主体'),
               2:('road','灰色石板路边缘+石块'),
               3:('road','灰色石板路边缘+石块'),
               4:('road','灰色石板路面'),
               5:('road','灰色石板路面'),
               6:('road','灰色石板路面'),
               7:('road','灰色石板路面'),
               8:('road','灰色石板路面'),
               9:('road','灰色石板路面'),
               10:('road','灰色石板路面'),
               11:('road','灰色石板路面边缘'),
               12:('road','灰色石板路面'),
               13:('road','灰色石板路面'),
               14:('road','灰色石板路面')},
    'shilu4': {0:('road','灰白石板路(石阶/浅色)'),
               1:('road','灰白石板路(竖接缝)'),
               2:('road','灰白石板路(石板拼接)'),
               3:('road','灰白石板路(大块石板)'),
               4:('road','灰白石板路(多块拼接)'),
               5:('road','灰白石板路'),
               6:('road','灰白石板路(接缝)'),
               7:('road','灰白石板路(边缘)'),
               8:('road','灰白石板路'),
               9:('road','灰白石板路(接缝)'),
               10:('road','灰白石板路(鹅卵石)'),
               11:('road','灰白石板路(碎岩)'),
               12:('road','灰白石板路(圆弧石板)'),
               13:('road','灰白石板路(竖缝)'),
               14:('road','灰白石板路(深色石板)')},
    'ggbangs': {0:('building','灰色砖/石墙+深棕边(建筑)'),
                1:('building','灰色砖石墙(建筑)'),
                2:('building','灰砖地面边缘(墙基)'),
                3:('building','棕色砖墙(建筑)'),
                4:('building','灰色瓦顶+木质墙(房屋角)'),
                5:('building','灰色砖墙+木质墙裙(建筑)'),
                6:('building','灰色砖墙+招牌窗(建筑)'),
                7:('building','石墙+木结构(建筑角/门口)'),
                8:('building','木质门框/墙壁片段'),
                9:('decoration','卷轴/纸张+木地板(告示/贴图)'),
                10:('decoration','纸张/文件背景(非tile贴图)'),
                11:('building','日式木拉门/障子窗(构件)'),
                12:('building','木质墙片'),
                13:('blank','深黑/空门洞底(空)'),
                14:('blank','深黑/空门洞底(空)'),
                15:('building','垂直木桩/木条(栅栏/墙)')},
}

def main():
    meta = json.load(open(JSON_META, encoding='utf-8'))['tilesets']
    # tileset 按 firstgid 排序
    meta = sorted(meta, key=lambda t: t['firstgid'])
    ts_index = {t['name']: t for t in meta}

    out_tilesets = []
    pav_whitelist = []   # 草地/泥土类 可铺
    road_whitelist = []  # 路类 可铺
    for name, per in CLASSES.items():
        ts = ts_index[name]
        first = ts['firstgid']
        tiles = []
        for idx in sorted(per):
            cat, nm = per[idx]
            safe = (cat in ('grass','dirt') or cat=='road')
            gid = first + idx
            tiles.append({'index': idx, 'gid': gid, 'category': cat,
                          'name': nm, 'safe_to_pave': safe})
            if safe:
                if cat in ('grass','dirt'):
                    pav_whitelist.append(gid)
                elif cat == 'road':
                    road_whitelist.append(gid)
        out_tilesets.append({'name': name, 'firstgid': first,
                             'tilecount': ts['tilecount'], 'tiles': tiles})

    result = {
        'tilesets': out_tilesets,
        'pavement_whitelist': sorted(pav_whitelist),
        'road_whitelist': sorted(road_whitelist),
    }
    json.dump(result, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('json written:', OUT_JSON, '| pavement gids:', pav_whitelist)
    print('road gids:', road_whitelist)

    # ---- markdown ----
    md = ['# 《乡村狂想曲》村地图 tileset tile 分类表',
          '',
          '> 生成方式: 每个图集裁 100×100 格子 → 4 格拼 2×2 大图调用 Agnes 视觉模型逐格识别,',
          '> 并用程序化像素分析(主色板占比/疏离色检测)对"纯地面/物件/水面/石板路"做精确交叉验证。',
          '> tilewidth = 100, gid = firstgid + index, index 为图集内 0 起始格子号。',
          '',
          '## 说明',
          '- 官方把几乎所有 tile 命名为"地面"(以"地"命名的图集), 但实际内容极度混杂: 草地/泥土/石板路是纯地面,',
          '  而陶罐/干草垛/木头/水井/建筑墙/门等是物件/装饰, 绝不能大面积铺。',
          '- 类别: grass=草地, dirt=泥土/沙地, road=石板路, water=水, building=建筑, house=房屋,',
          '  object=物件(罐/草/木/井/门), decoration=装饰, tree=树, blank=空白, unknown=无法识别。',
          '- safe_to_pave=true 仅对纯地面(草/泥/石板路)成立。',
          '',
          '## pavment_whitelist (可安全大面积铺地, 纯地面: 草地/泥土)',
          json.dumps(result['pavement_whitelist']),
          '',
          '## road_whitelist (可铺路, 纯石板路; 不宜铺草地)',
          json.dumps(result['road_whitelist']),
          '',
    ]
    for ts in out_tilesets:
        md += [f'## {ts["name"]}  (firstgid {ts["firstgid"]}, 共 {ts["tilecount"]} 格)',
               '', '| 编号(index) | gid | 内容 | 类别 | 可铺地 |',
               '|---|---|---|---|---|']
        for t in ts['tiles']:
            md.append(f'| {t["index"]} | {t["gid"]} | {t["name"]} | {t["category"]} | {"是" if t["safe_to_pave"] else "否"} |')
        md.append('')
    # 总结
    md += [
        '## 总结 / 结论',
        '**适合铺大草地/大地的 gid:** ' +
        ', '.join(map(str, result['pavement_whitelist'])) + '.',
        '',
        '**适合铺路的 gid (石板路):** ' +
        ', '.join(map(str, result['road_whitelist'])) + '。',
        '',
        '**绝对不能大面积用的 gid (含物件/装饰, 铺了会穿帮):**',
        ' `mulan 102` `mulan2 103` `mulan3 104` `mulan4 105`(木门/木纹); '
        '`cdui 340-345` `cdui2 346-347`(干草垛/稻草); '
        '`cichis 350-351`(草垛/告示牌); `cichis2 348-349`(木框水槽/水井); '
        '`mucai 758-763`(木板/木材); `tanzi1 834-837` `tanzi2 828-830` `tanzi3 832-833` `tanzi4 831`(陶罐/坛子); '
        '`shuijingssss 838-846`(水井/绳索/木桶); `ggbangs 985-1000`(建筑墙/门/栅栏).',
        '',
        '**水面 tiles (不可铺地, 用于河/湖/水井):** `shuic 660-667`。',
        '',
        '**空/空白 tiles:** `tanzi2 gid 827`、`ggbangs gid 998/999`(纯黑/空门洞底)。',
        '',
        '**"名不副实"的典型例子:**',
        '- `cdui/cdui2/cichis` 官方叫"地面"实为**干草垛/稻草堆/告示牌**(object/decoration)。',
        '- `tanzi*` 官方"地面"实为**陶罐/坛子**(object)。',
        '- `mucai` 官方"地面"实为**堆叠木板/木材**(object)。',
        '- `shuijingssss` 官方"地面"实为**水井+绳索+木桶**(object/building)。',
        '- `mulan*` 官方"地面"实为**木质门/木纹构件**(object)。',
        '- `ggbangs` 官方"地面"实为**建筑/砖墙/门/栅栏**(building/blank)。',
        '- `shuic` 官方"地面"实为**水面+水岸**(water, 不可铺)。',
        '- `shilu*` 系列则是真·石板路(road, 可铺路), 但注意视觉模型会把它误标成"石/门/墙", 经像素验证均为纯灰石材质。',
    ]
    md_text = '\n'.join(md) + '\n'
    open(OUT_MD, 'w', encoding='utf-8').write(md_text)
    print('md written:', OUT_MD)

if __name__ == '__main__':
    main()
