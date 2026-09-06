# -*- coding: utf-8 -*-
"""
_vision_run.py
对 _tiles_parts/ 下所有 2x2 拼图调用 Agnes 视觉模型逐格识别,
结果以 UTF-8 JSON 保存到 _vision_results.json (key=part文件名)。
单并发 + 退避重试, 规避 429 限流; 空结果自动重试。
"""
import os, sys, json, time, glob, io
sys.path.insert(0, r'D:\.claude\shared')
from PIL import Image
from parallel_ai import parallel_vision, DEFAULT_API_KEY, DEFAULT_BASE_URL
import requests, base64

PARTS_DIR = r'D:\agent社区\AgentFarm2\_tiles_parts'
OUT_JSON  = r'D:\agent社区\AgentFarm2\tools\_vision_results.json'

PROMPT = """你是像素游戏 tile 质检员。这是一张 2x2 拼图，明确包含 4 个格子：
格子1(左上)、格子2(右上)、格子3(左下)、格子4(右下)。每个格子下方有一行黄色小字标注(如 "xx#N (gid N)")，请忽略这些文字。
请逐个格子判断该格子的真实内容：是纯地面(草地/泥土/沙地/石板路/土路/水面) 还是含物体(罐子/石头/花/草堆/木头/工具/家具/建筑/墙/栅栏/装饰)。
严格按此格式回答，每格一行，格式为：
格子1: <简要内容描述>|<类别>
格子2: <简要内容描述>|<类别>
格子3: <简要内容描述>|<类别>
格子4: <简要内容描述>|<类别>
类别只能取：grass,dirt,road,water,house,building,object,decoration,tree,other,unknown
若某格无法判断，类别填 unknown。只输出这4行，不要其它话。"""

def b64_url(path):
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()

def call_once(path, prompt):
    url = f'{DEFAULT_BASE_URL}/chat/completions'
    headers = {'Authorization': f'Bearer {DEFAULT_API_KEY}', 'Content-Type': 'application/json'}
    payload = {
        'model': 'agnes-2.5-flash',
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': b64_url(path)}}
        ]}],
        'max_tokens': 800,
        'temperature': 0.1,
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=120)
    resp.raise_for_status()
    return resp.json()['choices'][0]['message']['content'] or ''

def run(path, retries=4):
    last = ''
    for i in range(retries):
        try:
            txt = call_once(path, PROMPT)
            txt = (txt or '').strip()
            if txt:
                return txt
            last = '(empty)'
        except Exception as e:
            last = f'ERROR {e}'
        time.sleep(4 + i * 3)
    return f'[[FAIL]] {last}'

def main():
    parts = sorted(glob.glob(os.path.join(PARTS_DIR, '*.png')))
    # 只处理尚未有结果的
    results = {}
    if os.path.exists(OUT_JSON):
        try:
            results = json.load(open(OUT_JSON, encoding='utf-8'))
        except Exception:
            results = {}
    todo = [p for p in parts if os.path.basename(p) not in results]
    print(f'total={len(parts)} pending={len(todo)}')
    for p in todo:
        name = os.path.basename(p)
        txt = run(p)
        results[name] = {'text': txt, 'path': p}
        print(f'== {name} ==')
        print(txt[:500])
        json.dump(results, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        time.sleep(2)
    print('\nDONE')

if __name__ == '__main__':
    main()
