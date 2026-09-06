# -*- coding: utf-8 -*-
"""重跑 vision 失败的 parts (空结果), 直到拿到非空或设定的轮数。
与 _vision_run.py 相同 prompt, 但用单并发送多次请求提高成功率。
"""
import os, sys, json, time, glob
sys.path.insert(0, r'D:\.claude\shared')
from parallel_ai import DEFAULT_API_KEY, DEFAULT_BASE_URL
import requests, base64

PARTS_DIR = r'D:\agent社区\AgentFarm2\_tiles_parts'
OUT_JSON  = r'D:\agent社区\AgentFarm2\tools\_vision_results.json'

PROMPT = """你是像素游戏 tile 质检员。这是一张 2x2 拼图，明确包含 4 个格子：
格子1(左上)、格子2(右上)、格子3(左下)、格子4(右下)。每个格子下方有一行黄色小字(如 "xx#N (gid N)")，忽略这些文字。
请逐个格子判断真实内容：纯地面(草地/泥土/沙地/石板路/土路/水面) 还是含物体(罐子/石头/花/草堆/木头/工具/家具/建筑/墙/栅栏/装饰/井)。
严格按此格式回答，每格一行：
格子1: <内容>|<类别>
格子2: <内容>|<类别>
格子3: <内容>|<类别>
格子4: <内容>|<类别>
类别只能取：grass,dirt,road,water,house,building,object,decoration,tree,other,unknown
若某格实在无法判断就写 unknown。只输出这4行。"""

def b64_url(path):
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()

def call_once(path):
    url = f'{DEFAULT_BASE_URL}/chat/completions'
    headers = {'Authorization': f'Bearer {DEFAULT_API_KEY}', 'Content-Type': 'application/json'}
    payload = {
        'model': 'agnes-2.5-flash',
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': PROMPT},
            {'type': 'image_url', 'image_url': {'url': b64_url(path)}}
        ]}],
        'max_tokens': 800, 'temperature': 0.2,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    r.raise_for_status()
    return (r.json()['choices'][0]['message']['content'] or '').strip()

def main():
    results = json.load(open(OUT_JSON, encoding='utf-8'))
    targets = [n for n, v in results.items() if 'FAIL' in v.get('text','')]
    print('重试目标:', targets)
    for name in targets:
        path = os.path.join(PARTS_DIR, name)
        got = ''
        for i in range(6):
            try:
                t = call_once(path)
                if t:
                    got = t; break
            except Exception as e:
                print(f'  {name} try{i}: {e}')
            time.sleep(5)
        if got:
            results[name] = {'text': got, 'path': path}
            print(f'OK {name}: {got[:200]}')
        else:
            print(f'STILL EMPTY {name}')
        json.dump(results, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        time.sleep(3)
    print('DONE')

if __name__ == '__main__':
    main()
