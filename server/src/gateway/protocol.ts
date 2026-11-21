// gateway/protocol.ts —— 协议校验（zod）：游戏通道 / 外部 agent 通道 / HTTP body
// 设计原则（与 legacy 行为等价）：字段缺失用 any 容错、未知 t 直接拒收（legacy switch 无 default 即忽略）；
// 强校验集中在结构层（t 必须命中已知指令、kv 必须为数组），业务字段保持宽松让 handler 自行 String()/Number() 转换。
// 数值字段走 num()、文本字段走 txt()：兼容字符串数字/数字文本/null/缺失（等价 legacy 的 String()/Number() 兜底），
// 仅拒绝无法转型为数值的垃圾入参（如 x:'abc'）——handler 的 NaN 守卫仍是最后防线。
import { z } from 'zod';

const any = z.any();
const num = z.coerce.number().nullish();
const txt = z.union([z.string(), z.coerce.string()]).nullish();

// ---------- 游戏通道 /ws ----------
export const GameJoinMsg = z.object({ t: z.literal('join'), uid: any, nick: txt, token: txt, scene: num, x: num, y: num }).passthrough();
export type GameJoinMsgT = z.infer<typeof GameJoinMsg>;
export const GameSaveMsg = z.object({ t: z.literal('save'), kv: z.array(z.any()).optional() }).passthrough();
export type GameSaveMsgT = z.infer<typeof GameSaveMsg>;
export const GameMoveMsg = z.object({ t: z.literal('move'), scene: num, x: num, y: num }).passthrough();
export type GameMoveMsgT = z.infer<typeof GameMoveMsg>;
export const GameChatMsg = z.object({ t: z.literal('chat'), text: txt }).passthrough();
export type GameChatMsgT = z.infer<typeof GameChatMsg>;
export const GameSocialTalkMsg = z.object({ t: z.literal('social_talk'), target: txt, text: txt }).passthrough();
export type GameSocialTalkMsgT = z.infer<typeof GameSocialTalkMsg>;
export const GameSocialGiveMsg = z.object({ t: z.literal('social_give'), target: txt, itemId: num, num: num }).passthrough();
export type GameSocialGiveMsgT = z.infer<typeof GameSocialGiveMsg>;
export const GameSocialFavMsg = z.object({ t: z.literal('social_fav'), target: txt }).passthrough();
export type GameSocialFavMsgT = z.infer<typeof GameSocialFavMsg>;
export const GameSocialBindMsg = z.object({ t: z.literal('social_bind'), target: txt, type: txt }).passthrough();
export type GameSocialBindMsgT = z.infer<typeof GameSocialBindMsg>;
export const GameSocialUnbindMsg = z.object({ t: z.literal('social_unbind'), target: txt }).passthrough();
export type GameSocialUnbindMsgT = z.infer<typeof GameSocialUnbindMsg>;
export const GameSocialTpMsg = z.object({ t: z.literal('social_tp'), target: txt }).passthrough();
export type GameSocialTpMsgT = z.infer<typeof GameSocialTpMsg>;
export const GameTaskListMsg = z.object({ t: z.literal('task_list') }).passthrough();
export type GameTaskListMsgT = z.infer<typeof GameTaskListMsg>;
export const GameAgentMsgMsg = z.object({ t: z.literal('agent_msg'), text: txt }).passthrough();
export type GameAgentMsgMsgT = z.infer<typeof GameAgentMsgMsg>;
export const GameDmSendMsg = z.object({ t: z.literal('dm_send'), target: txt, text: txt }).passthrough();
export type GameDmSendMsgT = z.infer<typeof GameDmSendMsg>;
export const GameDmLogMsg = z.object({ t: z.literal('dm_log'), target: txt }).passthrough();
export type GameDmLogMsgT = z.infer<typeof GameDmLogMsg>;
export const GameDmUnlockedMsg = z.object({ t: z.literal('dm_unlocked') }).passthrough();
export type GameDmUnlockedMsgT = z.infer<typeof GameDmUnlockedMsg>;
export const GameAgentInterruptMsg = z.object({ t: z.literal('agent_interrupt') }).passthrough();
export type GameAgentInterruptMsgT = z.infer<typeof GameAgentInterruptMsg>;
export const GameAgentResumeMsg = z.object({ t: z.literal('agent_resume') }).passthrough();
export type GameAgentResumeMsgT = z.infer<typeof GameAgentResumeMsg>;
export const GameAgentArriveMsg = z.object({ t: z.literal('agent_arrive'), index: num, x: num, y: num, scene: num }).passthrough();
export type GameAgentArriveMsgT = z.infer<typeof GameAgentArriveMsg>;
export const GameSpectateMsg = z.object({ t: z.literal('spectate'), watch: txt }).passthrough();
export type GameSpectateMsgT = z.infer<typeof GameSpectateMsg>;
export const GameUnspectateMsg = z.object({ t: z.literal('unspectate') }).passthrough();
export type GameUnspectateMsgT = z.infer<typeof GameUnspectateMsg>;

export const GameMsg = z.union([
  GameJoinMsg, GameSaveMsg, GameMoveMsg, GameChatMsg,
  GameSocialTalkMsg, GameSocialGiveMsg, GameSocialFavMsg, GameSocialBindMsg, GameSocialUnbindMsg, GameSocialTpMsg,
  GameTaskListMsg, GameAgentMsgMsg,
  GameDmSendMsg, GameDmLogMsg, GameDmUnlockedMsg,
  GameAgentInterruptMsg, GameAgentResumeMsg, GameAgentArriveMsg,
  GameSpectateMsg, GameUnspectateMsg,
]);
export type GameMsgT = z.infer<typeof GameMsg>;

/** 解析游戏通道消息：非对象/未知 t -> null（等价 legacy：忽略） */
export function parseGameMsg(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = GameMsg.safeParse(raw);
  return r.success ? (r.data as Record<string, unknown>) : null;
}

// ---------- 外部 agent 通道 /agent ----------
export const AgentObserveMsg = z.object({ t: z.literal('observe') }).passthrough();
export type AgentObserveMsgT = z.infer<typeof AgentObserveMsg>;
export const AgentInboxMsg = z.object({ t: z.literal('inbox') }).passthrough();
export type AgentInboxMsgT = z.infer<typeof AgentInboxMsg>;
export const AgentChatLogMsg = z.object({ t: z.literal('chat_log') }).passthrough();
export type AgentChatLogMsgT = z.infer<typeof AgentChatLogMsg>;
export const AgentMoveStateMsg = z.object({ t: z.literal('agent_move_state') }).passthrough();
export type AgentMoveStateMsgT = z.infer<typeof AgentMoveStateMsg>;
export const AgentDmSendMsg = z.object({ t: z.literal('dm_send'), target: txt, text: txt }).passthrough();
export type AgentDmSendMsgT = z.infer<typeof AgentDmSendMsg>;
export const AgentDmLogMsg = z.object({ t: z.literal('dm_log'), target: txt }).passthrough();
export type AgentDmLogMsgT = z.infer<typeof AgentDmLogMsg>;
export const AgentDmUnlockedMsg = z.object({ t: z.literal('dm_unlocked') }).passthrough();
export type AgentDmUnlockedMsgT = z.infer<typeof AgentDmUnlockedMsg>;
export const AgentActMsg = z.object({
  t: z.literal('act'), action: txt, dir: txt, text: txt, npcId: num, id: num, itemId: num,
  item: any, seed: num, count: num, x: num, y: num, seq: num, index: num, near: txt, wallHug: any,
}).passthrough();
export type AgentActMsgT = z.infer<typeof AgentActMsg>;
export const AgentPingMsg = z.object({ t: z.literal('ping') }).passthrough();
export type AgentPingMsgT = z.infer<typeof AgentPingMsg>;

// ---------- village-life: agent↔agent social + malice verbs + dismiss ----------
export const AgentSocialMsg = z.object({
  t: z.literal('social'),
  verb: z.enum(['greet', 'bond', 'fallout']),
  target: z.string(),
}).passthrough();
export type AgentSocialMsgT = z.infer<typeof AgentSocialMsg>;

export const AgentDismissMsg = z.object({
  t: z.literal('agent_dismiss'),
}).passthrough();
export type AgentDismissMsgT = z.infer<typeof AgentDismissMsg>;

export const AgentMaliceMsg = z.object({
  t: z.literal('malice'),
  verb: z.enum(['steal', 'clear']),
  x: num, y: num,
}).passthrough();
export type AgentMaliceMsgT = z.infer<typeof AgentMaliceMsg>;

export const AgentMsg = z.union([
  AgentObserveMsg, AgentInboxMsg, AgentChatLogMsg, AgentMoveStateMsg,
  AgentDmSendMsg, AgentDmLogMsg, AgentDmUnlockedMsg, AgentActMsg, AgentPingMsg,
  AgentSocialMsg, AgentDismissMsg, AgentMaliceMsg,
]);
export type AgentMsgT = z.infer<typeof AgentMsg>;

export function parseAgentMsg(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = AgentMsg.safeParse(raw);
  return r.success ? (r.data as Record<string, unknown>) : null;
}

// ---------- HTTP body ----------
export const RegisterBody = z.object({ username: z.string(), password: z.string() });
export type RegisterBodyT = z.infer<typeof RegisterBody>;
export const AgentProviderBody = z.object({ url: z.string(), model: z.string().optional(), key: z.string().optional() });
export type AgentProviderBodyT = z.infer<typeof AgentProviderBody>;
export const AgentControlBody = z.object({ action: z.enum(['start', 'stop']) });
export type AgentControlBodyT = z.infer<typeof AgentControlBody>;
export const SwitchSlotBody = z.object({ slot: z.number() });
export type SwitchSlotBodyT = z.infer<typeof SwitchSlotBody>;
export const RenameSlotBody = z.object({ slot: z.number().optional(), name: z.string().optional() });
export type RenameSlotBodyT = z.infer<typeof RenameSlotBody>;
export const JoinRoomBody = z.object({ code: z.string() });
export type JoinRoomBodyT = z.infer<typeof JoinRoomBody>;
export const GiveCoinsBody = z.object({ amount: z.number().optional() });
export type GiveCoinsBodyT = z.infer<typeof GiveCoinsBody>;
export const GiveItemBody = z.object({ itemId: z.number().optional(), amount: z.number().optional() });
export type GiveItemBodyT = z.infer<typeof GiveItemBody>;
export const AgentSetupBody = z.object({
  personality: z.string().optional(), name: z.string().optional(),
  playstyle: z.string().optional(), phrase: z.string().optional(),
});
export type AgentSetupBodyT = z.infer<typeof AgentSetupBody>;

/** 读 body JSON（超 sizeLimit 直接销毁连接，等价 legacy req.destroy） */
export async function readJsonBody(req: import('node:http').IncomingMessage, sizeLimit: number): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > sizeLimit) { req.destroy(); resolve(null); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}