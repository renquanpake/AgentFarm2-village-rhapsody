// world/night-events.ts —— §三 夜间自发社交活动框架（聚会 / 才艺比拼 / 月下闲谈）
// 每游戏日入夜（日推进钩子）触发：确定性伪随机选一种活动，
// 进公告板（noticeData，observe.notices 与 /af/notices 可读）+ 事件流留痕（回放/导演镜头可见）。
// 同一天同一结果：重启不换活动，活动选择与游戏日一一对应。
import type { App } from '../app.ts';
import { publishNotice } from './notices.ts';

export type NightActivityType = 'potluck' | 'contest' | 'gathering';

export interface NightActivity {
  type: NightActivityType;
  title: string;
  venueScene: number; // scene 2 = village
  hint: string;
}

const ACTIVITIES: NightActivity[] = [
  { type: 'potluck', title: '百家宴', venueScene: 2, hint: '各家带一道菜到宴会厅集合，品尝村民手艺' },
  { type: 'contest', title: '才艺比拼', venueScene: 2, hint: '钓鱼/种田/烹饪三项比赛，act 对应动词自动计分' },
  { type: 'gathering', title: '月下闲谈', venueScene: 2, hint: '村中心广场乘凉聊天，交换当日见闻' },
];

/** 入夜活动选择：每游戏日的确定性伪随机（mulberry32 风格散列，同日同结果） */
export function pickNightActivity(gameDay: number): NightActivity {
  const seed = Math.imul(gameDay, 2654435761) >>> 0;
  return ACTIVITIES[seed % ACTIVITIES.length];
}

/** 发布活动公告（日推进钩子调用）：公告板 + 事件流 */
export function publishNightActivity(app: App, gameDay: number): void {
  const act = pickNightActivity(gameDay);
  publishNotice(app.state, Date.now(), 'generic', `【夜间活动】${act.title}：${act.hint}`);
  app.log.append('night.activity', null, { type: act.type, title: act.title, day: gameDay });
}