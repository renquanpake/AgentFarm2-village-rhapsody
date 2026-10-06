// src/world/act-catalog.ts —— act 动作语义表（agent 接入的单一事实源）
// 契约：每条 = 一个 act 分支，args/returns 一行说清「怎么调 / 回什么」。
// 防漂移：test/unit/act-catalog.test.ts 从 ws.ts 源码正则提取真实分支名做全量比对，
//         新增 act 忘了进这张表 → 判红。
export interface ActEntry {
  /** act 名（与 ws.ts 的 action === '...' 分支同名） */
  act: string;
  /** 必填/可选参数（JSON 片段风格） */
  args: string;
  /** 返回要点（失败时给 agent 的可执行信息） */
  returns: string;
}

export const ACT_CATALOG: ActEntry[] = [
  { act: 'move', args: '{dir:"up"|"down"|"left"|"right"}', returns: '单格步行结果；前方障碍/地图边界给可读失败' },
  { act: 'move_to', args: '{x,y}像素 | {near:"water"|"npc"|建筑名} | {ring}邻接环', returns: 'move_started{waypoints,segMs}；已在目标则 ok；失败点名目标格与建议站立格' },
  { act: 'arrive', args: '{index,x,y,scene}', returns: '回报落点推进下一航点；偏差自动重规划（等价消息 {t:"agent_arrive"}）' },
  { act: 'chat', args: '{text}（≤200 字）', returns: '世界频道发言结果' },
  { act: 'talk', args: '{npcId|id}', returns: '与 NPC 对话（LLM 在场时带规则上下文）；不在场/太远给可读失败' },
  { act: 'reply', args: '{text}（≤500 字）', returns: '回复 NPC/信件' },
  { act: 'letter', args: '{to,body}（body≤400）', returns: '投进对方邮局（在线玩家可读）' },
  { act: 'mail', args: '{n?}（默认 5，上限 50）', returns: '自己的信件列表' },
  { act: 'recap', args: '{n?}（默认 12，上限 50）', returns: '近期操作复盘（归因用）' },
  { act: 'tasks', args: '{}', returns: '任务链视图：已解锁/进行中/完成计数与当前链' },
  { act: 'onboarding', args: '{}', returns: '新手引导进度与下一步提示' },
  { act: 'season', args: '{}', returns: '当日天象：day/季节/事件线 active 与 upcoming' },
  { act: 'forecast', args: '{}', returns: '明日天气/节日预告（生长倍率、风暴赔付提示）' },
  { act: 'buy', args: '{itemId|item, count?}', returns: '扣金币入包；金币不足/无此物品给可读失败' },
  { act: 'trade', args: '{op:"place"|"cancel"|"book", itemId, price?, num?}', returns: '订单簿挂单/撤单/撮合结果' },
  { act: 'recycle', args: '{itemId}', returns: '打铁炉回炉 1 个原料换废资价（只收木材 id=18；带 qty 可批量）；低于收购参考六折，是保底出口不是主卖货通道' },
  { act: 'stall', args: '{}', returns: '节日集市开摊（需钩子解冻+节日+摊位费）' },
  { act: 'delegate', args: '{op:"list"|"publish"|..., task?, itemId?, num?}', returns: '委托挂单/接取/结算结果' },
  { act: 'lease', args: '{op:"open"|"care"|"tick"|"status", plot, leaseMs?}', returns: '地块包租约状态与到期时间' },
  { act: 'report', args: '{}', returns: '银行（场景 102）资产日报；别处给「先 move_to {near:\"银行\"}」指引' },
  { act: 'train', args: '{attr:"力量"|"敏捷"|"亲和"}', returns: '健身房训练结果；不在健身房指引 move_to {near:"健身房"}' },
  { act: 'till', args: '{x,y}目标格', returns: '耕地结果（需站相邻格；水面/障碍/已犁给可读失败）' },
  { act: 'plant', args: '{itemId|seed, x,y}目标格', returns: '播种结果（需站相邻格；无种子/非可种土给可读失败）' },
  { act: 'water', args: '{x,y}目标格', returns: '浇水结果（需站相邻格；无作物/场景植物给可读失败）' },
  { act: 'harvest', args: '{x,y}目标格', returns: '收获结果（需站相邻格；未熟/场景植物给可读失败）' },
  { act: 'chop', args: '{x,y}目标格', returns: '砍树结果（需站相邻格；无树给可读失败）' },
  { act: 'fish', args: '{}', returns: '甩竿/收杆；不在水边或无鱼竿（id=6）给可读失败与等待秒数' },
  { act: 'mine', args: '{}', returns: '挖矿；不在矿点或无镐（id=58）给可读失败与歇息秒数' },
  { act: 'place', args: '{itemId, x,y}', returns: '放置 type=9 物品（洒水器等）' },
  { act: 'build', args: '{type, x?, y?}', returns: '建造设施结果（配方/材料/位置门给可读失败）' },
  { act: 'cook', args: '{recipeId?}（默认 2）', returns: '烹饪结果（需灶台；缺原料给可读失败）' },
  { act: 'decor_place', args: '{houseId?, decorId, x,y}', returns: '摆放装饰结果' },
  { act: 'decor_remove', args: '{x,y}', returns: '移除装饰结果' },
  { act: 'courtyard', args: '{houseId?}', returns: '庭院评分/完成度/赛事状态' },
  { act: 'claim', args: '{kind:"tree"|"plot"|"mine"|"stall"|"generic", x,y}', returns: '认领资源（5 分钟内别人动不了）' },
  { act: 'release', args: '{kind, x,y}', returns: '放弃认领' },
  { act: 'claims', args: '{}', returns: '我的认领清单（含像素坐标）' },
  { act: 'give', args: '{target, itemId, num?}', returns: '赠送结果（背包/额度校验失败给可读信息）' },
  { act: 'bind', args: '{target, type?}（默认 friend）', returns: '社交绑定结果' },
  { act: 'animals', args: '{}', returns: '我的动物列表' },
  { act: 'adopt', args: '{animalId|itemId?, x,y}', returns: '领养动物到目标格结果' },
  { act: 'feed', args: '{animalUid|uId, itemId?}', returns: '喂食结果（饱食度变化）' },
  { act: 'pet', args: '{animalUid|uId}', returns: '撸宠结果（亲密度变化）' },
];

/**
 * 非 act 的直发消息类型（agent 通道 / 游戏通道 case 分支）。
 * 与 ACT_CATALOG 分开：前者对齐 `action === '...`（测试做双向守卫），
 * 本表对齐 `case '...'` 中「agent 真会用到的消息类型」——测试做的是
 * 「表内每条都有 case」单向守卫（ws.ts 还有 join/save/move/social_* 等客户端消息，不在文档表内）。
 */
export const DIRECT_MESSAGES: ActEntry[] = [
  { act: 'observe', args: '{t:"observe"}', returns: 'state 世界快照：pos/scene/npcs/buildings/calendar/tasks/festival' },
  { act: 'agent_arrive', args: '{t:"agent_arrive",index,x,y,scene}', returns: '回报落点推进下一航点；偏差自动重规划' },
  { act: 'agent_move_state', args: '{t:"agent_move_state"}', returns: '查询是否正在移动（moving 布尔）' },
  { act: 'agent_interrupt', args: '{t:"agent_interrupt"}', returns: '打断当前移动（≤200ms 内广播 agent_move_done）' },
  { act: 'agent_resume', args: '{t:"agent_resume"}', returns: '恢复被暂停的移动' },
  { act: 'task_list', args: '{t:"task_list"}', returns: '任务链清单视图' },
  { act: 'inbox', args: '{t:"inbox"}', returns: '收件箱（含未读计数与信文）' },
  { act: 'agent_msg', args: '{t:"agent_msg",…}', returns: '向自己客户端推送 agent 侧消息' },
  { act: 'ping', args: '{t:"ping"}', returns: 'pong（连通性探测）' },
];

/** 动作名清单（按目录顺序） */
export const ACT_NAMES: string[] = ACT_CATALOG.map((e) => e.act);

/** 一行式动作清单：每条一行，供 rulesPrompt / welcome / 文档复用
 *  预算：整表 ≤600 token（终审要求：完整动作表必须装得进 rulesPrompt 的 1200 预算，
 *  此前 2427 字符/1214 token 会让拼装器恒降档到「压缩动作名」分支，等于没交付） */
export function catalogText(): string {
  return [...ACT_CATALOG, ...DIRECT_MESSAGES].map((e) => `${e.act} ${e.args} → ${e.returns}`).join('\n');
}

/** 高频动作：紧凑渲染时仍给全参数（agent 日常真正会调的那些） */
export const HIGH_FREQ_ACTS = new Set([
  'move', 'move_to', 'arrive', 'observe', 'chat', 'talk', 'buy', 'trade', 'recycle', 'letter',
  'till', 'plant', 'water', 'harvest', 'chop', 'fish', 'mine', 'tasks', 'forecast', 'report', 'train',
]);

/** returns 紧凑形：取第一分句并截断（「目标格动作需站相邻格；无种子…」→「目标格动作需站相邻格」） */
function shortReturns(s: string): string {
  const first = s.split('；')[0].trim();
  return first.length <= 12 ? first : first.slice(0, 12) + '…';
}

/** args 紧凑形：砍掉 `|备选` 尾巴并截断（保留主参数名，agent 照 observe 提示即可） */
function shortArgs(s: string): string {
  const head = s.replace(/\s*\|[^|]*$/, '').trim();
  return head.length <= 20 ? head : head.slice(0, 20) + '…';
}

/** 紧凑渲染时仍带「返回要点」的动作（返回语义会改变 agent 行为的那几个）；
 *  其余只给 act+参数：26 人名册与价目比低频动作的失败文案更值钱（终审预算取舍） */
export const RETURNS_ACTS = new Set(['move_to', 'plant', 'water', 'harvest', 'till', 'buy', 'talk', 'chop']);

/** 动作清单紧凑行：给 rulesPrompt 的 1200 token 预算用。
 *  契约：①全部动作名都出现（agent 不会凭空发明动作）②高频动作带参数与首要返回
 *  ③≤560 token（终审硬指标：全表 1214 token 会让拼装器恒降档，规格 §3.1 第 2 项等于没交付） */
export function catalogTextTerse(): string {
  return [...ACT_CATALOG, ...DIRECT_MESSAGES]
    .map((e) => (RETURNS_ACTS.has(e.act) ? `${e.act} ${shortArgs(e.args)} → ${shortReturns(e.returns)}` : `${e.act}${shortArgs(e.args)}`))
    .join('\n');
}

/** agent welcome notice：从本表派生，保证「文档说的」与「代码做的」同源 */
export function catalogNotice(): string {
  return [
    'AgentFarm2 游戏接入。',
    '发 {t:"observe"} 看世界快照（pos/scene/npcs/buildings/tasks/calendar）。',
    '发 {t:"act",action:"…"} 行动，动作语义表：',
    catalogText(),
    '坐标：x/y 用像素坐标（格 → 坐标=格*100+50，如格 15 → 1550）。',
    '目标格动作（till/plant/water/harvest/chop/place/decor_*/build/claim/release/adopt）需站在目标格相邻格。',
    'move_to 返回 waypoints 与 segMs（每段毫秒），用 {t:"agent_arrive",index,x,y} 确认落点；无回应会自动盲推兜底。',
    '移动中重复下单会被拒（上一个移动还没走完），先等 agent_move_done 或 {t:"agent_interrupt"} 打断。',
  ].join('\n');
}