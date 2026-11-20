# 技术设计：村民共居玩法升级（village-life）

> 承接 requirements.md。已落地部分标注【已落地】。

## 1. 数据层

`data/personalities.json`【已落地】：100 张卡 = {id,name,tone,hobbies[],scores{七维},total,note}。
机器可读源与 personalities-roster.md 同口径（钟形：暖光1/暖心17/温吞18/随和28/阴冷18/乖戾17/寒渊1）。

## 2. 习惯引擎 `world/habits.ts`【已落地】

- **加载**：loadPersonas(dataDir)，路径缓存，缺文件回落空表（无关角色行为不变）。
- **权重合成**：base=1 全动词；有卡时 hobby boost = 3 × max(0.4, 1+勤×0.05)（懒散压平是特性）；dimMul 按 |分值|≥4 修边：
  - 俭≥4 → market×(1+0.05s)；俭≤-4 → cook/festival 放大（挥霍往享受花钱）
  - 疏≥4 → festival/market；疏≤-4 → fish/mine/decor（独处）
  - 勇≥4 → festival（冲比赛）；勇≤-4 → farm/cook（平和）
  - 善≥4 → cook/animal（分享与照看）；诚≤-4 → market（钻营）
- **排序**：weight + rng()×0.15 抖动，mulberry32(f(gameDay,cardId))。
- **习惯语**：TONE_ADJ[tone] + HOBBY_LINE[topVerb]，叠加 |值|≥7 的单条 DIM_CLAUSE（俭/疏/勇），≤40 字。
- **写卡**：rememberCard(state,uid,cardId) 落 globals.afCardAssign.val（{val:{uid:id}} 包装惯例），供下期抽卡端点用。

## 3. 注入点

- `cognition/observe.ts`【已落地】：agent observe.state 增 habits{sentence,today(top3 labels)}；读 afCardAssign.val[uid]，无卡→null 不污染。
- 次日计划提示词（planDailyLlm/llmDailyPlan）：planDailyLlm 与 runSleepCycle 运行时暂未接线——接线时把 ctx.habits 并入序列化即自动送达大脑【待接线，随下批】。
- 抽卡端点（重抽一次语义）：HTTP 路由 + 客户端 UI【下期，UI 阶段】。

## 4. 存档与门禁

- globals 键 afCardAssign 已登记 GLOBAL_KEYS（state.ts:28），门11 通过。
- 门9 回放一致性由确定性种子保证（不依赖 Date.now）。

## 5. 验证法

- 单测 test/unit/habits.test.ts 8 项：同卡对照（拆爱好/清零七维）、合成卡极端维度、确定性逐字相等、无卡中性、习惯语长度。
- 回归：tsc --noEmit 零错 + vitest 全量绿。