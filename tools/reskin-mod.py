#!/usr/bin/env python3
# tools/reskin-mod.py —— M1 机械重皮肤：agentfarm.js 内联色值 -> var(--af-*) 映射替换
# 规则：逐 token 映射表（长词优先避免子串误伤）；仅替换样式字符串语境
import re, sys

MAP = {
    # 背景/面板
    "#1a1f26": "var(--af-c-bg)",
    "#20242a": "var(--af-c-panel-deep)",
    "#20262e": "var(--af-c-panel-deep)",
    "#262c34": "var(--af-c-panel-deep)",
    "#26303a": "var(--af-c-panel-deep)",
    "#2a3038": "var(--af-c-panel-deep)",
    "#2c3138": "var(--af-c-panel-deep)",
    "#2c333c": "var(--af-c-panel-deep)",
    "#3a4450": "var(--af-c-panel)",
    "#48535f": "var(--af-c-edge)",
    # 文字
    "#c8d0da": "var(--af-c-text)",
    "#cfd8dc": "var(--af-c-text)",
    "#dde3ea": "var(--af-c-text)",
    "#9aa4b0": "var(--af-c-text-dim)",
    "#8a94a0": "var(--af-c-text-dim)",
    "#7a8490": "var(--af-c-text-dim)",
    "#6b7684": "var(--af-c-text-dim)",
    "#777": "var(--af-c-text-dim)",
    "#888": "var(--af-c-text-dim)",
    "#eee": "var(--af-c-light-soft)",
    "#fff": "var(--af-c-light)",
    "#e8e0cc": "var(--af-c-paper)",
    "#e8ecf1": "var(--af-c-paper-hud)",
    # 金/琥珀
    "#ffd97a": "var(--af-c-gold)",
    "#ffe27a": "var(--af-c-gold)",
    "#ffd27a": "var(--af-c-gold)",
    "#f0b64c": "var(--af-c-amber)",
    "#f0b850": "var(--af-c-amber)",
    "#ef9a3c": "var(--af-c-amber)",
    "#e48a2c": "var(--af-c-amber)",
    "#f7a845": "var(--af-c-amber)",
    "#d97e24": "var(--af-c-amber)",
    # 警示暖族
    "#ff9a7a": "var(--af-c-danger)",
    "#ffb87a": "var(--af-c-danger)",
    "#ff7a7a": "var(--af-c-danger)",
    # 木
    "#9a7428": "var(--af-c-wood-dark)",
    "#8a5a2a": "var(--af-c-wood-dark)",
    "#7a6a4a": "var(--af-c-wood)",
    "#b5a06e": "var(--af-c-wood)",
    "#6b4a3a": "var(--af-c-wood)",
    # 天蓝
    "#8fb0d8": "var(--af-c-sky)",
    "#4a6a8a": "var(--af-c-sky-deep)",
    "#7ad0ff": "var(--af-c-sky-bright)",
    # 绿族
    "#3a6b4a": "var(--af-c-moss)",
    "#3a7a4a": "var(--af-c-moss)",
    "#5a8a4a": "var(--af-c-moss)",
    "#8fae6a": "var(--af-c-moss)",
    "#5a6b3a": "var(--af-c-moss)",
    "#9ae87a": "var(--af-c-success)",
    "#8ad97a": "var(--af-c-success)",
    # 0
    "#000": "var(--af-c-black-70)",
    # rgba 阶
    "rgba(38,44,52,.9)": "var(--af-c-glass-panel)",
    "rgba(52,60,70,.95)": "var(--af-c-glass-solid)",
    "rgba(30,34,40,.85)": "var(--af-c-glass-bg)",
    "rgba(8,10,14,.88)": "var(--af-c-glass-bg-deep)",
    "rgba(255,217,122,.08)": "var(--af-c-glow-gold)",
    "rgba(0,0,0,.4)": "var(--af-c-black-40)",
    "rgba(0,0,0,.6)": "var(--af-c-black-60)",
    "rgba(0,0,0,.7)": "var(--af-c-black-70)",
}

p = "/workspace/agent-farm/client/mod/agentfarm.js"
s = open(p, encoding="utf-8").read()
total = 0
# 长键优先（避免 #2 类短前缀误伤）
for k in sorted(MAP, key=len, reverse=True):
    n = s.count(k)
    if n:
        s = s.replace(k, MAP[k])
        total += n
open(p, "w", encoding="utf-8").write(s)
print(f"reskin: {total} 处替换")
# 残留检查
import re as _re
left = sorted(set(_re.findall(r"#[0-9a-fA-F]{3,8}\b", s)))
print("残留 hex:", left if left else "无")
left2 = sorted(set(_re.findall(r"rgba?\(\s*\d[^)]{1,24}\)", s)))
print("残留 rgb:", left2 if left2 else "无")
