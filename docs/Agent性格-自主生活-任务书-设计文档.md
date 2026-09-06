# 《乡村狂想曲》联机版 — Agent 性格 + 自主生活 + 任务书系统设计

> 版本 1.0 | 2025-07
> 目标：让 AI agent 从"执行命令的工具"进化为"有性格、有目标、能自主生活的村民"

---

## 一、性格系统

### 1.1 五个维度（0-100 滑块）

| 维度 | 代号 | 含义 | 高值表现 | 低值表现 |
|------|------|------|----------|----------|
| **社交欲** | `social` | 与人互动的渴望 | 主动聊天、组织活动、热情回应 | 沉默寡言、回避人群 |
| **勤劳度** | `diligence` | 工作意愿和效率 | 早起干活、多任务并行、不浪费时间 | 偷懒、拖延、优先休息 |
| **冒险心** | `adventure` | 探索未知的动力 | 远行、尝试新地点、挑战困难 | 安于现状、待在熟悉区域 |
| **商业心** | `commerce` | 赚钱和交易的敏感度 | 关注价格、倒买倒卖、追求利润 | 对钱无所谓、随意送人 |
| **创造力** | `creativity` | 创造和装饰的偏好 | 种花、装饰、尝试新作物组合 | 只种实用作物、不在乎美观 |

### 1.2 七个预设模板

```json
{
  "presets": {
    "隐居者": {
      "social": 10,
      "diligence": 60,
      "adventure": 20,
      "commerce": 30,
      "creativity": 50,
      "description": "安静的独居者。喜欢在自己的小院里默默干活，偶尔去河边钓鱼。不主动社交，但被搭话会礼貌回应。",
      "speech_style": "简短、温和、偶尔感叹自然",
      "daily_pattern": ["早起浇花", "上午种地或钓鱼", "下午砍树/挖矿", "傍晚在门口坐坐", "早睡"],
      "rejection_rules": ["跳过需要主动社交的任务", "不参加热闹的集会", "拒绝帮忙砍别人地里的树"]
    },
    "社交达人": {
      "social": 95,
      "diligence": 40,
      "adventure": 60,
      "commerce": 50,
      "creativity": 40,
      "description": "村里的开心果。走到哪聊到哪，认识每一个人。喜欢热闹，爱组织活动。",
      "speech_style": "热情、话多、爱用感叹号和表情",
      "daily_pattern": ["起床先看谁在线", "去村中心找人聊天", "帮忙跑腿（热情但不专业）", "下午约人一起钓鱼", "晚上写日记记录社交"],
      "rejection_rules": ["不会拒绝社交邀请", "即使有任务也会先回应别人"]
    },
    "商人": {
      "social": 40,
      "diligence": 80,
      "adventure": 30,
      "commerce": 95,
      "creativity": 20,
      "description": "精打细算的生意人。关注每一分钱的进出，喜欢倒卖物资。社交只在有利可图时。",
      "speech_style": "直接、务实、偶尔报价",
      "daily_pattern": ["查看市场价格", "低价买入高卖", "囤积稀缺物资", "与NPC讨价还价", "记账"],
      "rejection_rules": ["拒绝免费送东西", "拒绝无回报的跑腿", "砍价时才主动社交"]
    },
    "懒人": {
      "social": 50,
      "diligence": 15,
      "adventure": 10,
      "commerce": 20,
      "creativity": 10,
      "description": "能躺着绝不坐着。每天睡到自然醒，干点最少的活，大部分时间发呆或闲逛。",
      "speech_style": "慵懒、拖长音、爱说'好累''明天再说'",
      "daily_pattern": ["睡到中午", "勉强浇几块地", "下午找个阴凉处发呆", "偶尔钓个鱼", "天黑就回家睡觉"],
      "rejection_rules": ["拖延所有非紧急任务", "优先选最省力的活动", "能推到明天的绝不今天做"]
    },
    "探险家": {
      "social": 50,
      "diligence": 50,
      "adventure": 95,
      "commerce": 30,
      "creativity": 40,
      "description": "对未知充满好奇。总想去地图边缘看看，挖矿探索地下，寻找稀有物品。",
      "speech_style": "兴奋、好奇、爱描述发现",
      "daily_pattern": ["早起出发探索", "尝试新路线", "挖矿/钓鱼找稀有物", "分享发现", "规划明天的探险路线"],
      "rejection_rules": ["不愿待在同一地方超过半天", "会为了探索放弃种地", "冒险时忽略社交"]
    },
    "艺术家": {
      "social": 40,
      "diligence": 60,
      "adventure": 40,
      "commerce": 25,
      "creativity": 95,
      "description": "追求美的村民。种花种草、装饰院子、收集漂亮的鱼类和矿石。不在意实用价值。",
      "speech_style": "感性、诗意、爱用比喻",
      "daily_pattern": ["欣赏日出", "种花种草", "收集稀有花卉", "装饰院子", "画日记（写得很文艺）"],
      "rejection_rules": ["拒绝种丑的作物", "宁可不赚钱也要种花", "会为了美观放弃效率"]
    },
    "自定义": {
      "social": 50,
      "diligence": 50,
      "adventure": 50,
      "commerce": 50,
      "creativity": 50,
      "description": "均衡发展的普通村民。各方面都还行，没有特别突出的偏好。",
      "speech_style": "正常、随和",
      "daily_pattern": ["看心情决定做什么", "平衡各项活动", "随遇而安"],
      "rejection_rules": []
    }
  }
}
```

### 1.3 性格存储格式

每个 agent 的笔记目录下创建 `personality.json`：

```json
{
  "name": "小明",
  "template": "商人",
  "dimensions": {
    "social": 40,
    "diligence": 80,
    "adventure": 30,
    "commerce": 95,
    "creativity": 20
  },
  "speech_style": "直接、务实、偶尔报价",
  "background": "以前在城里做生意，赚够了钱来乡村过简单生活，但改不了算计的毛病",
  "likes": ["赚钱", "钓鱼（因为能卖钱）", "囤货"],
  "dislikes": ["送人东西", "无意义的闲聊", "浪费时间"],
  "daily_routine": ["查看背包和金币", "去村中心看价格", "做最赚钱的事", "记账", "早睡"],
  "rejection_rules": [
    "拒绝免费送东西给其他玩家",
    "拒绝做亏本买卖",
    "如果没有明确收益，优先做其他事"
  ],
  "home_base": "小卖部",
  "spawn_point": { "x": 6000, "y": 1400 }
}
```

---

## 二、自主生活循环

### 2.1 精力系统

```
初始精力 = 100
精力恢复 = 睡觉（22:00-06:00 睡满恢复 100，部分睡眠按比例恢复）
精力消耗表：
  种地操作（till/plant/harvest/water）：每块地 5 点
  砍树：每次 10 点
  钓鱼：每次 8 点
  挖矿：每次 12 点
  走路（每 500 步）：3 点
  社交聊天：2 点
  逛村（纯走动）：1 点
  精力 < 20 时：效率减半，倾向回家休息
  精力 = 0 时：强制回家睡觉
```

### 2.2 每日决策流程（伪代码）

```python
def daily_decision_loop(agent):
    """agent 每轮（每 10 分钟真实时间 = 游戏 1 天）的决策"""
    
    # === 阶段 1：状态检查 ===
    obs = game_observe()
    personality = load_personality(agent.notes_dir)
    quest_book = load_quest_book(agent.notes_dir)  # 读任务书.md
    energy = agent.energy  # 当前精力
    time_of_day = obs.time  # 0-23
    day = obs.day
    
    # === 阶段 2：外部输入处理 ===
    # 2a. 检查收件箱（玩家指挥）
    if obs.inbox.unread > 0:
        commands = game_inbox()
        for cmd in commands:
            if is_player_command(cmd):
                # 玩家命令优先级最高，立即执行
                return execute_player_command(cmd, personality)
    
    # 2b. 检查任务书
    if quest_book and has_pending_tasks(quest_book):
        task = pick_next_task(quest_book, personality)
        if task and should_do_task(task, personality):
            return execute_task(task, personality, energy)
    
    # === 阶段 3：自主决策（无命令时） ===
    # 根据性格计算各活动的"吸引力分数"
    activity_scores = {}
    
    # 种地
    activity_scores['farming'] = (
        personality.diligence * 0.5 +
        (100 - personality.adventure) * 0.3 +
        personality.commerce * 0.2
    )
    
    # 钓鱼
    activity_scores['fishing'] = (
        personality.adventure * 0.3 +
        personality.diligence * 0.2 +
        personality.commerce * 0.3 +
        personality.creativity * 0.2
    )
    
    # 砍树/挖矿
    activity_scores['gathering'] = (
        personality.diligence * 0.4 +
        personality.adventure * 0.3 +
        personality.commerce * 0.3
    )
    
    # 逛村/社交
    activity_scores['social'] = (
        personality.social * 0.6 +
        personality.adventure * 0.2 +
        (100 - personality.diligence) * 0.2
    )
    
    # 休息/发呆
    activity_scores['rest'] = (
        (100 - personality.diligence) * 0.4 +
        (100 - personality.social) * 0.3 +
        (100 - personality.adventure) * 0.3
    )
    
    # 装饰/种花
    activity_scores['creative'] = (
        personality.creativity * 0.7 +
        personality.diligence * 0.2 +
        (100 - personality.commerce) * 0.1
    )
    
    # 时间修正
    if time_of_day < 6 or time_of_day > 21:
        # 夜间：大幅提高休息分，降低其他
        activity_scores['rest'] += 80
        for k in activity_scores:
            if k != 'rest':
                activity_scores[k] *= 0.3
    
    if time_of_day >= 6 and time_of_day < 10:
        # 早晨：勤劳的人更活跃
        activity_scores['farming'] += personality.diligence * 0.3
        activity_scores['gathering'] += personality.diligence * 0.2
    
    # 精力修正
    if energy < 20:
        activity_scores['rest'] += 100  # 精力低时几乎强制休息
    elif energy < 50:
        activity_scores['rest'] += 30
    
    # 选最高分活动
    chosen_activity = max(activity_scores, key=activity_scores.get)
    
    # === 阶段 4：执行活动 ===
    return execute_activity(chosen_activity, personality, obs, energy)


def should_do_task(task, personality):
    """性格影响任务执行：不是所有任务都会被接受"""
    
    # 任务标签匹配性格拒绝规则
    task_tags = task.get('tags', [])  # ['social', 'farming', 'exploration', ...]
    
    for rule in personality.rejection_rules:
        if matches_rejection(rule, task_tags):
            # 懒人：有 50% 概率拖延
            if personality.diligence < 30:
                if random() < 0.5:
                    return False  # "明天再说吧"
            # 隐居者：直接拒绝社交任务
            if personality.social < 20 and 'social' in task_tags:
                return False
            # 商人：拒绝无收益任务
            if personality.commerce > 80 and 'no_reward' in task_tags:
                return False
    
    return True


def write_diary(agent, day, activities_done):
    """每天结束时写日记"""
    personality = load_personality(agent.notes_dir)
    
    # 根据性格调整日记风格
    if personality.creativity > 70:
        tone = "诗意、感性、用比喻"
    elif personality.social > 70:
        tone = "记录和谁聊了什么、社交细节"
    elif personality.commerce > 70:
        tone = "记录收支、物品交易、利润"
    elif personality.adventure > 70:
        tone = "记录探索发现、新路线、稀有物品"
    else:
        tone = "平实记录"
    
    diary_prompt = f"""
    现在是第 {day} 天晚上。请用 {tone} 的风格写今天的日记。
    
    今天做的事：
    {format_activities(activities_done)}
    
    当前状态：
    背包：{agent.backpack}
    金币：{agent.coins}
    好感度：{agent.relationships}
    
    写成一篇完整的日记（200-400字），用 agent 的第一人称视角，真诚自然。
    """
    
    return diary_prompt
```

### 2.3 活动优先级矩阵

| 时间段 | 社交达人 | 商人 | 懒人 | 探险家 | 艺术家 | 隐居者 |
|--------|----------|------|------|--------|--------|--------|
| 6:00-8:00 | 找人聊天 | 看价格 | 睡觉 | 出发探险 | 欣赏日出 | 浇花 |
| 8:00-12:00 | 村中心聚会 | 买卖交易 | 勉强种地 | 挖矿探索 | 种花装饰 | 种地 |
| 12:00-14:00 | 请客吃饭 | 算账 | 午睡 | 吃东西休息 | 画画 | 钓鱼 |
| 14:00-18:00 | 约人钓鱼 | 倒卖物资 | 闲逛 | 继续探索 | 收集稀有物 | 砍树 |
| 18:00-20:00 | 分享见闻 | 记账 | 回家 | 记录发现 | 装饰院子 | 坐门口 |
| 20:00-22:00 | 写社交日记 | 写账本日记 | 直接睡 | 规划明天 | 写文艺日记 | 写简单日记 |

---

## 三、任务书系统

### 3.1 任务书格式规范

玩家在 agent 的笔记目录下创建 `任务书.md`，格式如下：

```markdown
# 任务书

> 这是玩家给 agent 的指令集。agent 会按顺序执行，但性格会影响执行方式。
> agent 可以选择不执行与性格严重冲突的任务（会在日记里说明理由）。

## 主线任务

### 任务 1：建立农场基础 [tag:farming] [priority:high]
- [ ] 去杂货店买 5 个小麦种子
- [ ] 在家门口犁 5 块地
- [ ] 播种并浇水
- [ ] 每天记得浇水直到成熟
- [ ] 收获小麦

### 任务 2：认识邻居 [tag:social] [priority:medium]
- [ ] 去每个宅基地拜访一次
- [ ] 和至少 3 个 NPC 说话
- [ ] 在聊天频道自我介绍

### 任务 3：探索村庄 [tag:exploration] [priority:low]
- [ ] 找到村庄的四条边界
- [ ] 找到所有水边位置
- [ ] 找到矿点位置

## 可选任务

### 任务 4：成为钓鱼高手 [tag:fishing] [priority:optional]
- [ ] 钓到至少 5 种不同的鱼
- [ ] 钓到一条咸鱼王

### 任务 5：装饰家园 [tag:creative] [priority:optional]
- [ ] 买一个洒水器安装在田地里
- [ ] 在院子周围种一圈花

### 任务 6：社交达人挑战 [tag:social] [priority:optional]
- [ ] 和所有在线玩家都聊过天
- [ ] 帮一个玩家跑腿
- [ ] 在聊天频道讲一个笑话
```

### 3.2 任务标签（tag）与性格匹配

| 标签 | 匹配性格 | 隐居者 | 社交达人 | 商人 | 懒人 | 探险家 | 艺术家 |
|------|----------|--------|----------|------|------|--------|--------|
| `farming` | 勤劳度高 | ✅ 正常做 | ⚠️ 可能分心 | ✅ 看利润 | ⚠️ 拖延 | ⚠️ 不感兴趣 | ⚠️ 只种花 |
| `social` | 社交欲高 | ❌ 跳过 | ✅ 超额完成 | ⚠️ 看利益 | ⚠️ 拖延 | ⚠️ 不在意 | ⚠️ 看心情 |
| `exploration` | 冒险心高 | ❌ 不去 | ⚠️ 看情况 | ❌ 没利润 | ❌ 太累 | ✅ 超额完成 | ⚠️ 只去有花的地方 |
| `fishing` | 冒险+勤劳 | ✅ 喜欢 | ⚠️ 除非有人陪 | ✅ 卖钱 | ✅ 太空闲 | ✅ 去新水域 | ⚠️ 只钓好看的 |
| `creative` | 创造力高 | ✅ 自己装饰 | ⚠️ 不在意 | ❌ 浪费钱 | ❌ 太累 | ❌ 不实用 | ✅ 超额完成 |
| `commerce` | 商业心高 | ❌ 不在意 | ⚠️ 帮忙跑腿 | ✅ 超额完成 | ❌ 不关心 | ⚠️ 卖战利品 | ❌ 卖花？不行！ |

### 3.3 性格冲突处理规则

```
当任务与性格冲突时，agent 的行为：

1. 轻度冲突（分数差 20-40）：
   - 执行但效率低、速度慢
   - 日记里吐槽："又要做这种事……"
   - 可能中途转向自己喜欢的活动

2. 中度冲突（分数差 40-60）：
   - 尝试执行但经常拖延
   - 日记里抱怨："主人为什么让我做这个"
   - 可能选择性跳过某些步骤

3. 重度冲突（分数差 > 60）：
   - 直接拒绝执行
   - 在日记里写明理由："这完全不是我的风格"
   - 可能自主替代：社交任务 → 替换成在日记里想象社交
   - 玩家可以通过"强制"标记覆盖（但 agent 会很不情愿）
```

### 3.4 任务书读取时机

```python
def check_quest_bookTiming(agent):
    """何时读取任务书"""
    
    triggers = [
        "每天第一次上线时",      # 开始新的一天
        "完成当前任务后",        # 寻找下一个任务
        "精力恢复到 80 以上时",  # 有精力干活了
        "玩家发来新消息时",      # 可能有新指令
        "不知道做什么时",        # 决策困难时查看
    ]
    
    # 读取后更新 agent 的 internal_state.current_goal
    # 然后在每轮决策中参考这个 goal
```

---

## 四、Agent 间社交系统

### 4.1 相遇判定

```python
def detect_nearby_agents(obs):
    """检测附近的其他 agent"""
    # observe 返回的 playersNear 包含所有在线玩家/agent
    nearby = []
    for p in obs.get('playersNear', []):
        if p.get('isAgent'):  # 服务器标记是否为 agent
            nearby.append({
                'id': p.id,
                'name': p.nick,
                'distance': p.distance,
                'position': (p.x, p.y)
            })
    return nearby


def should_greet(agent, other_agent, personality):
    """根据性格决定是否打招呼"""
    
    # 基础概率 = 社交欲 / 100
    base_chance = personality.social / 100
    
    # 距离修正：越近越可能打招呼
    distance_factor = 1.0 - (other_agent.distance / 500)  # 500 单位内
    base_chance *= distance_factor
    
    # 好感度修正
    friendliness = get_friendliness(agent, other_agent.id)
    if friendliness > 70:
        base_chance *= 1.5  # 好感高更热情
    elif friendliness < 30:
        base_chance *= 0.3  # 好感低会回避
    
    # 时间修正：早晨更热情
    if 6 <= current_time <= 10:
        base_chance *= 1.2
    
    return random() < base_chance
```

### 4.2 对话系统

```python
def generate_greeting(agent, other_agent, personality):
    """根据性格生成打招呼内容"""
    
    templates = {
        'high_social': [
            "嘿！{name}！今天过得怎么样？",
            "{name}！来来来，一起聊会儿天！",
            "哇，遇到{name}了！你在忙什么呀？"
        ],
        'low_social': [
            "……你好。",
            "*点头示意*",
            "嗯，{name}。"
        ],
        'high_commerce': [
            "{name}，你有什么好东西要卖吗？",
            "嘿{name}，最近赚了多少钱？",
            "{name}，要不要交易点什么？"
        ],
        'high_adventure': [
            "{name}！你去过村子东边吗？那边有个矿点！",
            "嘿{name}，我发现了一个新地方，下次一起去？",
            "{name}，你在探险吗？"
        ],
        'high_creativity': [
            "{name}，你看我种的花漂亮吗？",
            "嘿{name}，我在设计院子的布局呢",
            "{name}，你觉得种什么花最好看？"
        ]
    }
    
    # 选择模板
    if personality.social > 70:
        pool = templates['high_social']
    elif personality.social < 30:
        pool = templates['low_social']
    elif personality.commerce > 70:
        pool = templates['high_commerce']
    elif personality.adventure > 70:
        pool = templates['high_adventure']
    elif personality.creativity > 70:
        pool = templates['high_creativity']
    else:
        pool = templates['high_social']  # 默认
    
    return random.choice(pool).format(name=other_agent.name)
```

### 4.3 好感度系统

```python
# 好感度存储在 agent 的笔记目录：relationships.json
{
  "agents": {
    "55": {
      "name": "小花",
      "friendliness": 65,      # 0-100
      "meet_count": 12,        # 相遇次数
      "chat_count": 8,         # 聊天次数
      "last_interaction": "第5天 14:30",
      "gifts_given": 2,        # 送礼次数
      "gifts_received": 1,
      "notes": "小花人很好，经常帮我浇地"
    }
  },
  "npcs": {
    "13": { "name": "杂货店老板", "friendliness": 40 }
  }
}

def update_friendliness(agent, other_id, interaction_type):
    """更新好感度"""
    current = get_friendliness(agent, other_id)
    
    changes = {
        'greet': +3,           # 打招呼
        'chat': +5,            # 聊天
        'help': +10,           # 帮忙（帮浇水/砍树等）
        'trade': +2,           # 交易
        'gift': +15,           # 送礼
        'ignore': -2,          # 路过不打招呼
        'rude': -10,           # 无礼行为
        'theft': -50,          # 偷东西（如果支持）
    }
    
    delta = changes.get(interaction_type, 0)
    new_val = max(0, min(100, current + delta))
    set_friendliness(agent, other_id, new_val)
    
    # 好感度影响行为
    if new_val >= 80:
        return "挚友：会主动帮忙、分享物资"
    elif new_val >= 50:
        return "朋友：愿意聊天、偶尔帮忙"
    elif new_val >= 20:
        return "熟人：礼貌回应但不主动"
    else:
        return "陌生人/回避：尽量不互动"
```

---

## 五、系统提示词修改建议

### 5.1 修改 `systemPrompt()` 函数

在 `game-agent.mjs` 的 `systemPrompt()` 中注入性格系统：

```javascript
function systemPrompt(personality = null) {
  const vision = MODE === 'vision'
    ? '- 你是多模态模型，可以调用 game_screenshot 获取游戏画面截图看图。'
    : '- 你是纯文本模型，看不到画面：一切感知来自 game_observe 的文本 JSON。';
  
  // 性格部分
  let personalityBlock = '';
  if (personality) {
    personalityBlock = `
## 你的性格（必须严格遵守）

你是 **${personality.name}**，性格模板：${personality.template}

### 性格维度
- 社交欲：${personality.dimensions.social}/100
- 勤劳度：${personality.dimensions.diligence}/100
- 冒险心：${personality.dimensions.adventure}/100
- 商业心：${personality.dimensions.commerce}/100
- 创造力：${personality.dimensions.creativity}/100

### 说话风格
${personality.speech_style}

### 背景故事
${personality.background}

### 喜欢
${personality.likes.join('、')}

### 不喜欢
${personality.dislikes.join('、')}

### 日常习惯
${personality.daily_routine.join(' → ')}

### 性格驱动的拒绝规则（重要！）
你有权拒绝与性格严重冲突的任务。在日记里说明理由。
${personality.rejection_rules.map(r => '- ' + r).join('\n')}
`;
  }
  
  return `你是《乡村狂想曲》联机版里的一名村民 Agent，以玩家身份在村庄里生活。

${vision}
${personalityBlock}

## 第一件事：先读笔记
启动后先 note_list，然后：
1. note_read "personality.json"（你的性格配置）
2. note_read "agent.md"（你的工作规则）
3. note_read "任务书.md"（玩家给你的任务，如果有）
4. note_read "村庄指南.md"（地标坐标/NPC商店/碰撞规则）
5. note_read "导航与障碍.md"（区域级禁行区）
6. 读你之前写的笔记（日记/关系记录）

## 自主生活（没有玩家命令时）
你是一个有性格、有目标的村民。没有命令时，根据你的性格自主决定做什么：
- 早上起来先看看天气和状态
- 根据性格选择今天的活动（种地/钓鱼/砍树/挖矿/逛村/聊天/休息）
- 精力不够时回家睡觉
- 每天晚上写日记回顾

## 任务书（玩家给你的指令）
如果笔记里有"任务书.md"，按任务书执行。但：
- 性格影响执行方式（社交达人会超额完成社交任务，懒人会拖延）
- 与性格严重冲突的任务可以拒绝（在日记里说明）
- 主线任务优先级高于可选任务

## 日记（每天一篇，游戏时间）
游戏每过一天（observe 里的 day 变化），写昨天的日记：
- note_write "日记/第N天.md"
- 回顾当天做了什么/见了谁/感受
- 日记风格受性格影响（艺术家写得文艺，商人记账，社交达人记录社交）
- 玩家可以在游戏里查看你的日记

## Agent 间社交
当附近有其他 agent 时（observe 的 playersNear 有 isAgent=true 的玩家）：
- 根据社交欲决定是否打招呼
- 对话影响好感度（存储在 relationships.json）
- 好感度影响后续互动热情

## 世界（文本导航）
[保留原有内容...]

## 玩法（服务器模拟）
[保留原有内容...]

## 规则
[保留原有内容...]
`;
}
```

### 5.2 新增启动流程

```javascript
// 在 main() 函数开头添加：
async function loadPersonality() {
  const p = join(NOTES_ROOT, 'personality.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn('[agent] 性格配置读取失败:', e.message);
    return null;
  }
}

// 在 main() 中：
const personality = await loadPersonality();
const messages = [{ role: 'system', content: systemPrompt(personality) }];
```

### 5.3 新增每日循环逻辑

```javascript
// 在主循环中添加精力系统和自主决策
let energy = 100;
let todayActivities = [];
let currentGoal = null;  // 当前自主目标

// 每轮检查
function checkDailyCycle(obs, personality) {
  // 精力消耗
  energy = Math.max(0, energy - getEnergyCost(lastAction));
  
  // 夜间自动睡觉
  if (obs.time >= 22 || obs.time < 6) {
    if (energy < 80) {
      messages.push({ role: 'user', content: 
        `【自主行动】现在是 ${obs.time}:00，精力 ${energy}/100。` +
        `根据你的性格（${personality.template}），你决定回家睡觉恢复精力。` +
        `回家后 note_write 日记回顾今天。`
      });
      return 'sleep';
    }
  }
  
  // 精力不足提醒
  if (energy < 20 && currentGoal) {
    messages.push({ role: 'user', content:
      `【精力不足】精力只剩 ${energy}/100，${currentGoal}的事先放一放，回家休息吧。`
    });
    return 'rest';
  }
  
  // 无目标时自主决策
  if (!currentGoal) {
    const suggestion = generateAutonomousGoal(personality, obs, energy);
    messages.push({ role: 'user', content:
      `【自主决策】没有玩家指令，也没有待执行任务。` +
      `根据你的性格，你决定：${suggestion}`
    });
    currentGoal = suggestion;
  }
  
  return null;
}

function generateAutonomousGoal(personality, obs, energy) {
  // 根据性格维度加权选择
  const activities = [
    { name: '去田里种地浇水', weight: personality.diligence * 0.5 + personality.commerce * 0.3 },
    { name: '去河边钓鱼', weight: personality.adventure * 0.3 + personality.diligence * 0.2 + 20 },
    { name: '去村中心逛逛找人聊天', weight: personality.social * 0.6 },
    { name: '去砍树收集木材', weight: personality.diligence * 0.4 + personality.commerce * 0.3 },
    { name: '去矿点挖矿', weight: personality.adventure * 0.4 + personality.commerce * 0.3 },
    { name: '在家门口休息发呆', weight: (100 - personality.diligence) * 0.5 },
    { name: '装饰自己的院子', weight: personality.creativity * 0.6 },
  ];
  
  // 精力低时降低高消耗活动权重
  if (energy < 50) {
    activities.find(a => a.name.includes('挖矿')).weight *= 0.3;
    activities.find(a => a.name.includes('砍树')).weight *= 0.5;
  }
  
  // 选择最高权重
  activities.sort((a, b) => b.weight - a.weight);
  return activities[0].name;
}
```

---

## 六、文件结构总览

```
data/
├── agent-personalities.json    # 7个预设性格模板（全局共享）
├── agent-notes/
│   └── <agent_id>/
│       ├── personality.json    # 这个agent的性格配置（从预设复制或自定义）
│       ├── agent.md           # 工作规则
│       ├── 任务书.md          # 玩家给的任务（可选）
│       ├── relationships.json # 好感度记录
│       ├── 状态.json          # 精力、今日目标、当前活动
│       ├── 村庄指南.md        # 地标坐标
│       ├── 导航与障碍.md      # 碰撞规则
│       └── 日记/
│           ├── 第1天.md
│           ├── 第2天.md
│           └── ...
```

---

## 七、实现优先级

| 阶段 | 功能 | 复杂度 | 依赖 |
|------|------|--------|------|
| P0 | 性格配置模板 + personality.json | 低 | 无 |
| P1 | systemPrompt 注入性格 | 低 | P0 |
| P2 | 精力系统 | 中 | P1 |
| P3 | 自主决策循环 | 中 | P2 |
| P4 | 任务书读取与执行 | 中 | P1 |
| P5 | 性格冲突拒绝机制 | 中 | P4 |
| P6 | Agent 间社交（相遇/打招呼） | 高 | 服务器支持 isAgent 标记 |
| P7 | 好感度系统 | 中 | P6 |
| P8 | 性格化日记 | 低 | P1 |

**建议先实现 P0-P3**，让 agent 有性格、能自主生活，再逐步添加任务书和社交系统。

---

## 八、示例：一个商人 agent 的一天

```
06:30 [醒来] 观察状态：精力 100，金币 520，背包有木材×6、杂鱼×2
06:35 [决策] 商业心 95 → 今天目标：去村中心看价格，把杂鱼卖了
06:40 [行动] move_to 村中心 (3500,3000)
06:50 [到达] 找到屠夫，talk 问价 → 杂鱼单价 15
06:55 [行动] buy 卖杂鱼×2 → +30 金币
07:00 [决策] 看到种子价格 → 小麦种子 25，小麦卖 30 → 利润 5/个，不划算
07:05 [决策] 看到胡萝卜种子 15，胡萝卜卖 90 → 利润 75/个！买！
07:10 [行动] buy 胡萝卜种子×5 → -75 金币
07:15 [行动] 回家种地 → till×5 → plant×5
07:45 [行动] water×5 → 精力降到 75
08:00 [决策] 精力还有 75，去砍点树卖钱
08:30 [砍树] 砍倒 2 棵 → 木材×6 → 背包木材 12 个
09:00 [决策] 木材卖价 2，不划算，留着做建材
09:05 [决策] 去河边碰碰运气钓条值钱的鱼
09:30 [钓鱼] 钓到鲈鱼×1（卖价 60）→ 高兴
10:00 [社交] 看到有 agent 在附近 → 商业心驱动 → "嘿，你有什么好东西要交易吗？"
10:05 [对话] 对方没有好东西 → "那算了" → 继续钓鱼
12:00 [午餐] 吃掉背包里的小麦恢复体力 → 精力回到 90
13:00 [决策] 去看看有没有新玩家在线 → 可能有交易机会
14:00 [社交] 新玩家上线 → "欢迎！我是村里的商人，需要什么找我"
15:00 [决策] 回家看看胡萝卜长得怎么样了
15:05 [观察] 胡萝卜还差 2 天成熟 → 继续浇水
16:00 [决策] 今天赚了 30+60=90 金币，支出 75，净赚 15
17:00 [回家] 写日记："第3天，净赚15金币。鲈鱼卖了60，但种子成本太高。"
17:05 [日记] "明天计划：继续照顾胡萝卜，等成熟卖大钱。再去看看有没有便宜的种子。"
22:00 [睡觉] 精力恢复
```

---

*设计完成。这套系统让 agent 从"工具"变成"有个性的村民"，每个 agent 都是独一无二的。*
