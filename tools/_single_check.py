# -*- coding: utf-8 -*-
"""对 _tiles_single/ 中单个大图 tile 逐个调用视觉模型做高精度确认。
用法: python _single_check.py <tileset名>...   输出 UTF-8 JSON 到 _single_results.json"""
import os, sys, json, time, glob
sys.path.insert(0, r'D:\.claude\shared')
from parallel_ai import DEFAULT_API_KEY, DEFAULT_BASE_URL
import requests, base64

SINGLE_DIR = r'D:\agent社区\AgentFarm2\_tiles_single'
OUT_JSON   = r'D:\agent社区\AgentFarm2\tools\_single_results.json'

PROMPT = """这是一张单个 100x100 的像素游戏地面/装饰 tile (已放大3倍)。请做最精确的判断：
1. 它是什么内容？（纯草地/泥土/沙地/石板路/土路/水面/井/罐子/罐子/草堆/木头/墙/门/建筑/装饰...）
2. 它是"纯地面"(可以安全大面积铺地) 还是"含物件"(罐子/石头/花/草堆/木头/工具/家具/建筑/装饰/井)？
只回答一行，格式：
内容: <一句话描述> | 类别: grass|dirt|road|water|house|building|object|decoration|tree|other|unknown | 是否纯地面: yes|no"""

def b64_url(p):
    return 'data:image/png;base64,' + base64.b64encode(open(p,'rb').read()).decode()

def call_one(p):
    url=f'{DEFAULT_BASE_URL}/chat/completions'
    h={'Authorization':f'Bearer {DEFAULT_API_KEY}','Content-Type':'application/json'}
    pl={'model':'agnes-2.5-flash','messages':[{'role':'user','content':[
        {'type':'text','text':PROMPT},{'type':'image_url','image_url':{'url':b64_url(p)}}]}],
        'max_tokens':300,'temperature':0.1}
    r=requests.post(url,json=pl,headers=h,timeout=120); r.raise_for_status()
    return (r.json()['choices'][0]['message']['content'] or '').strip()

def main():
    names = sys.argv[1:] or ['cdui','cichis','cichis2','byuand']
    res = {}
    if os.path.exists(OUT_JSON):
        res = json.load(open(OUT_JSON, encoding='utf-8'))
    files = []
    for n in names:
        files += sorted(glob.glob(os.path.join(SINGLE_DIR, f'{n}_*.png')))
    for p in files:
        key = os.path.basename(p)
        if key in res: continue
        t = call_one(p) or '(empty)'
        res[key] = t
        print(f'== {key} ==')
        print(t[:200])
        json.dump(res, open(OUT_JSON,'w',encoding='utf-8'), ensure_ascii=False, indent=1)
        time.sleep(3)
    print('DONE', len(res))

if __name__ == '__main__':
    main()
