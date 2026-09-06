import re, zlib, base64, struct, sys
sys.stdout.reconfigure(encoding='utf-8')
t = open(r'D:\agent社区\AgentFarm\assets\maps\zhujuejia.tmx', encoding='utf-8').read()

def layer_data(name):
    m = re.search(r'<layer[^>]*name="%s"[^>]*>.*?<data[^>]*>(.*?)</data>' % name, t, re.S)
    if not m: return None
    data_tag = m.group(0)
    enc = re.search(r'<data[^>]*encoding="(\w+)"', data_tag)
    body = m.group(1).strip()
    if enc and enc.group(1) == 'csv':
        return [int(x) for x in body.replace('\n','').split(',')]
    b64 = body.replace('\n','').replace(' ','')
    raw = zlib.decompress(base64.b64decode(b64))
    return list(struct.unpack('<%dI' % (len(raw)//4), raw))

W = H = 29
def show(name, thresh=None):
    d = layer_data(name)
    if d is None:
        print(name, 'NOT FOUND'); return
    print('==', name, 'len', len(d))
    for y in range(H):
        row = d[y*W:(y+1)*W]
        print(''.join('.' if v == 0 else ('#' if thresh is None or v >= thresh else 'o') for v in row))

show('fz')
print()
show('di1')
print()
show('cdii')
