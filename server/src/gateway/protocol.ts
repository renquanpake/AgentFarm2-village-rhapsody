// gateway/protocol.ts —— 协议校验（zod）：游戏通道 / 外部 agent 通道 / HTTP body
// 设计原则（与 legacy 行为等价）：字段缺失用 any 容错、未知 t 直接拒收（legacy switch 无 default 即忽略）；
// 强校验集中在结构层（t 必须命中已知指令、kv 必须为数组），业务字段保持宽松让 handler 自行 String()/Number() 转换。
import { z } from 'zod';

const any = z.any();

// ---------- 游戏通道 /ws ----------
export const GameJoinMsg = z.object({ t: z.literal('join'), uid: any, nick: any, token: any, scene: any, x: any, y: any }).passthrough();
export const GameSaveMsg = z.object({ t: z.literal('save'), kv: z.array(z.any()).optional() }).passthrough();
export const GameMoveMsg = z.object({ t: z.literal('move'), scene: any, x: any, y: any }).passthrough();
export const GameChatMsg = z.object({ t: z.literal('chat'), text: any }).passthrough();
export const GameSocialTalkMsg = z.object({ t: z.literal('social_talk'), target: any, text: any }).passthrough();
export const GameSocialGiveMsg = z.object({ t: z.literal('social_give'), target: any, itemId: any, num: any }).passthrough();
export const GameSocialFavMsg = z.object({ t: z.literal('social_fav'), target: any }).passthrough();
export const GameSocialBindMsg = z.object({ t: z.literal('social_bind'), target: any, type: any }).passthrough();
export const GameSocialUnbindMsg = z.object({ t: z.literal('social_unbind'), target: any }).passthrough();
export const GameSocialTpMsg = z.object({ t: z.literal('social_tp'), target: any }).passthrough();
export const GameTaskListMsg = z.object({ t: z.literal('task_list') }).passthrough();
export const GameAgentMsgMsg = z.object({ t: z.literal('agent_msg'), text: any }).passthrough();
export const GameDmSendMsg = z.object({ t: z.literal('dm_send'), target: any, text: any }).passthrough();
export const GameDmLogMsg = z.object({ t: z.literal('dm_log'), target: any }).passthrough();
export const GameDmUnlockedMsg = z.object({ t: z.literal('dm_unlocked') }).passthrough();
export const GameAgentInterruptMsg = z.object({ t: z.literal('agent_interrupt') }).passthrough();
export const GameAgentResumeMsg = z.object({ t: z.literal('agent_resume') }).passthrough();
export const GameAgentArriveMsg = z.object({ t: z.literal('agent_arrive'), index: any, x: any, y: any, scene: any }).passthrough();
export const GameSpectateMsg = z.object({ t: z.literal('spectate'), watch: z.any() }).passthrough();
export const GameUnspectateMsg = z.object({ t: z.literal('unspectate') }).passthrough();

export const GameMsg = z.union([
  GameJoinMsg, GameSaveMsg, GameMoveMsg, GameChatMsg,
  GameSocialTalkMsg, GameSocialGiveMsg, GameSocialFavMsg, GameSocialBindMsg, GameSocialUnbindMsg, GameSocialTpMsg,
  GameTaskListMsg, GameAgentMsgMsg,
  GameDmSendMsg, GameDmLogMsg, GameDmUnlockedMsg,
  GameAgentInterruptMsg, GameAgentResumeMsg, GameAgentArriveMsg,
  GameSpectateMsg, GameUnspectateMsg,
]);

/** 解析游戏通道消息：非对象/未知 t -> null（等价 legacy：忽略） */
export function parseGameMsg(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = GameMsg.safeParse(raw);
  return r.success ? (r.data as Record<string, unknown>) : null;
}

// ---------- 外部 agent 通道 /agent ----------
export const AgentObserveMsg = z.object({ t: z.literal('observe') }).passthrough();
export const AgentInboxMsg = z.object({ t: z.literal('inbox') }).passthrough();
export const AgentChatLogMsg = z.object({ t: z.literal('chat_log') }).passthrough();
export const AgentMoveStateMsg = z.object({ t: z.literal('agent_move_state') }).passthrough();
export const AgentDmSendMsg = z.object({ t: z.literal('dm_send'), target: any, text: any }).passthrough();
export const AgentDmLogMsg = z.object({ t: z.literal('dm_log'), target: any }).passthrough();
export const AgentDmUnlockedMsg = z.object({ t: z.literal('dm_unlocked') }).passthrough();
export const AgentActMsg = z.object({
  t: z.literal('act'), action: any,
  dir: any, text: any, npcId: any, id: any, itemId: any, item: any, seed: any,
  count: any, x: any, y: any, seq: any,
  index: any, near: any, wallHug: any,
}).passthrough();
export const AgentPingMsg = z.object({ t: z.literal('ping') }).passthrough();

export const AgentMsg = z.union([
  AgentObserveMsg, AgentInboxMsg, AgentChatLogMsg, AgentMoveStateMsg,
  AgentDmSendMsg, AgentDmLogMsg, AgentDmUnlockedMsg, AgentActMsg, AgentPingMsg,
]);

export function parseAgentMsg(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = AgentMsg.safeParse(raw);
  return r.success ? (r.data as Record<string, unknown>) : null;
}

// ---------- HTTP body ----------
export const RegisterBody = z.object({ username: z.string(), password: z.string() });
export const AgentProviderBody = z.object({ url: z.string(), model: z.string().optional(), key: z.string().optional() });
export const AgentControlBody = z.object({ action: z.enum(['start', 'stop']) });
export const SwitchSlotBody = z.object({ slot: z.number() });
export const RenameSlotBody = z.object({ slot: z.number().optional(), name: z.string().optional() });
export const JoinRoomBody = z.object({ code: z.string() });
export const GiveCoinsBody = z.object({ amount: z.number().optional() });
export const AgentSetupBody = z.object({
  personality: z.string().optional(), name: z.string().optional(),
  playstyle: z.string().optional(), phrase: z.string().optional(),
});

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
