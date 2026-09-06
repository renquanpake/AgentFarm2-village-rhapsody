from PIL import Image
import sys
sys.stdout.reconfigure(encoding='utf-8')
# 裁 bjj_di1.png 4 格 + bjj_cdi.png 4 格 拼一张对比图
im1 = Image.open(r'D:\agent社区\AgentFarm\client\public\maps\daditu\bjj_di1.png')
im2 = Image.open(r'D:\agent社区\AgentFarm\client\public\maps\daditu\bjj_cdi.png')
print('di1 size:', im1.size, 'cdi size:', im2.size)
tw = 100
def grid(im, label, out, offset_y):
    w, h = im.size
    cols = w // tw
    for i in range(cols * (h // tw)):
        gx = i % cols; gy = i // cols
        tile = im.crop((gx*tw, gy*tw, gx*tw+tw, gy*tw+tw))
        # 缩小到 50x50 拼到大图
        tile = tile.resize((50, 50))
        out.paste(tile, (offset_y*0 + i*60 + 5, offset_y*220 + 5))
        # 在 tile 下方标注
        from PIL import ImageDraw
        d = ImageDraw.Draw(out)
        d.text((i*60 + 10, offset_y*220 + 58), f'{label}{i+1}', fill=(255,255,255))
canvas = Image.new('RGB', (640, 480), (40, 40, 40))
grid(im1, 'di1_', canvas, 0)
grid(im2, 'cdi_', canvas, 1)
canvas.save(r'D:\agent社区\AgentFarm2\_ground_tiles.png')
print('saved _ground_tiles.png')
