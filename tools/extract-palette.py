#!/usr/bin/env python3
# tools/extract-palette.py —— C6 调色板提取（design M5b.1）：从原版精灵 PNG 提取 16 色锚定调色板
# 用法：python3 tools/extract-palette.py [sprite1.png ...]  （缺省自动采样 client/assets 下的精灵）
# 输出：tools/art-prompts/palette-v1.json（含版本号 + 来源清单，每次生成可追溯）
import glob, json, os, sys, collections
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PALETTE_OUT = os.path.join(ROOT, 'tools', 'art-prompts', 'palette-v1.json')

def sample_files(explicit):
    if explicit:
        return explicit
    # 自动：原版精灵（server/public/client/sprites 已提取的真实 PNG）
    pats = [
        os.path.join(ROOT, 'server', 'public', 'client', 'sprites', '*.png'),
        os.path.join(ROOT, 'client', 'assets', 'resources', 'native', '**', '*.png'),
    ]
    files = []
    for p in pats:
        files += glob.glob(p, recursive=True)
    files = sorted(set(files))
    # 采样上限（避免全量慢）：均匀取 40 张
    if len(files) > 40:
        step = len(files) / 40
        files = [files[int(i * step)] for i in range(40)]
    return files

def top_colors(files, n=16):
    counter = collections.Counter()
    for f in files:
        try:
            im = Image.open(f).convert('RGBA')
        except Exception:
            continue
        if im.width * im.height > 4096:
            im = im.resize((64, 64), Image.NEAREST)
        for r, g, b, a in im.getdata():
            if a < 128:
                continue  # 透明/近透明不算
            counter[(r, g, b)] += 1
    total = sum(counter.values()) or 1
    picked = [c for c, _ in counter.most_common(n * 6)]
    # 去重相近色（曼哈顿距离 < 48 视为同色系，保留更高频）
    final = []
    for c in picked:
        if all(sum(abs(a - b) for a, b in zip(c, f)) >= 48 for f in final):
            final.append(c)
        if len(final) == n:
            break
    # 收尾：不足 16 时放宽到距离 >= 24 继续补
    for c in picked:
        if len(final) == n:
            break
        if c not in final and all(sum(abs(a - b) for a, b in zip(c, f)) >= 24 for f in final):
            final.append(c)
    palette = []
    for c in final[:n]:
        palette.append({
            'hex': '#%02x%02x%02x' % c,
            'rgb': list(c),
            'freq': round(counter[c] / total, 5),
        })
    return palette, [os.path.relpath(f, ROOT) for f in files], total

def main():
    explicit = sys.argv[1:]
    files = sample_files(explicit)
    if not files:
        print('no sprite files found'); sys.exit(1)
    palette, sources, total = top_colors(files)
    os.makedirs(os.path.dirname(PALETTE_OUT), exist_ok=True)
    out = {
        'version': 'v1',
        'count': len(palette),
        'palette': palette,
        'sources': sources[:40],
        'total_samples': total,
        'note': '从原版精灵提取的 16 色锚定调色板（去重相近色后）；生图 prompt 必须引用本清单 hex',
    }
    with open(PALETTE_OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('palette v1 ->', PALETTE_OUT, '(%d colors, %d files)' % (len(palette), len(sources)))

if __name__ == '__main__':
    main()
