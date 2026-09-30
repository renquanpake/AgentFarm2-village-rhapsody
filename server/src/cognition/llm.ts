// cognition/llm.ts —— C 轨 LLM 编排层（M4 编排走 M7 路由）：
// chat/embedding 调用（OpenAI 兼容）+ 玩家 Key 路由 + 结果缓存 + 无 Key 优雅降级。
// 服务端零池化密钥：Key 仅存内存（RoutedCall），禁落日志/事件；计量走 llm_usage。
import type { App } from '../app.ts';
import { routeForAgent, ResultCache, meteredRoute, hashStr } from './router.ts';
import { pseudoEmbed } from './memory.ts';
import { keyvaultAvailable, readLlmKey } from '../persistence/keyvault.ts';

void routeForAgent;

const moduleCache = new ResultCache({ ttlMs: 10 * 60 * 1000, maxEntries: 1024 });

export interface LlmOps {
  available: boolean;
  chat(agent: string, system: string, user: string, taskType?: string): Promise<string | null>;
  embed(agent: string, text: string): Promise<number[] | null>;
}

/** 构造 LLM 操作集（无 Key -> 全部降级：chat null / embed 伪向量） */
export function createLlmOps(app: App, agentUid: string, accountUid?: string): LlmOps {
  const accounts = app.accounts;
  const owner = accountUid ?? (accounts?.findAccountByUid ? (accounts.findAccountByUid(agentUid)?.uid ?? agentUid) : agentUid);
  const p = app.provider ?? { url: '', key: '', model: '' };
  const global = { url: p.url ?? '', key: p.key ?? '', model: p.model ?? '' };
  const hasKey = !!(global.url && global.key) || (keyvaultAvailable() && !!readLlmKey(app.db, owner)?.hasCipher);
  return {
    available: hasKey,
    chat: async (agent, system, user, taskType = 'write') => {
      const m = meteredRoute(app.db, global, owner, agent, taskType, `${system}|${user}`, moduleCache);
      if (m.hit) return String(moduleCache.get(m.cacheKey).value ?? '');
      if (m.call.source === 'none' || !m.call.key) return null; // 降级
      try {
        const res = await fetch(`${m.call.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.call.key}` },
          body: JSON.stringify({
            model: m.call.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: 0.4,
            max_tokens: 512,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const text = j.choices?.[0]?.message?.content ?? null;
        m.record(j.usage?.prompt_tokens, j.usage?.completion_tokens);
        if (text) moduleCache.set(m.cacheKey, text);
        return text;
      } catch { return null; } // 网络/超时 -> 降级（规则兜底）
    },
    embed: async (agent, text) => {
      const m = meteredRoute(app.db, global, owner, agent, 'embed', text, moduleCache);
      if (m.hit) return moduleCache.get(m.cacheKey).value as number[] | null;
      if (m.call.source === 'none' || !m.call.key) return pseudoEmbed(text); // 无 Key -> 伪向量
      try {
        const res = await fetch(`${m.call.baseUrl.replace(/\/$/, '')}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.call.key}` },
          body: JSON.stringify({ model: m.call.model, input: [text] }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return pseudoEmbed(text); // embeddings 不支持 -> 伪向量兜底
        const j = (await res.json()) as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number } };
        m.record(j.usage?.prompt_tokens, 0);
        const v = j.data?.[0]?.embedding;
        if (Array.isArray(v) && v.length) { moduleCache.set(m.cacheKey, v); return v; }
        return pseudoEmbed(text);
      } catch { return pseudoEmbed(text); }
    },
  };
}

/** 记忆条目 embedding（LLM 优先，回落伪向量） */
export async function embedMemory(llm: LlmOps, agent: string, content: string, modelTag?: string): Promise<number[]> {
  const v = await llm.embed(agent, content);
  void modelTag;
  return v ?? pseudoEmbed(content);
}

/** LLM 三元组抽取（compact 档；失败回落规则）：返回 <=3 条 */
export async function llmExtract(llm: LlmOps, agent: string, eventJson: string): Promise<Array<{ s: string; p: string; o: string; conf: number }> | null> {
  const text = await llm.chat(agent,
    '你是游戏世界知识抽取器。从事件 JSON 抽取最多 3 条 (subject,predicate,object) 三元组，置信度 0-1。只输出 JSON 数组。',
    `${eventJson}`, 'extract');
  if (!text) return null;
  try {
    const m = text.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : text) as Array<{ s: string; p: string; o: string; conf?: number }>;
    return arr.slice(0, 3).map(t => ({ s: String(t.s), p: String(t.p), o: String(t.o), conf: typeof t.conf === 'number' ? t.conf : 0.7 }));
  } catch { return null; }
}

/** LLM 次日计划（flagship 档；失败回落规则 planDaily） */
export async function llmDailyPlan(llm: LlmOps, agent: string, ctx: { persona: string; weather: string; festival: string | null; memorySummary: string[]; topActions: string[] }): Promise<string[] | null> {
  const system = '你是像素农场游戏的角色规划器。根据人设/天气/节日/记忆/倾向动作，输出明日 3-5 条可执行计划（简短中文，每行一条，不要编号前缀以外的内容）。';
  const user = JSON.stringify(ctx);
  const text = await llm.chat(agent, system, user, 'plan');
  if (!text) return null;
  const lines = text.split('\n').map(s => s.replace(/^[\s\d\.、\-—]+/, '').trim()).filter(Boolean);
  return lines.length ? lines.slice(0, 5) : null;
}

export function cacheKeyOf(task: string, text: string): string { return hashStr(`${task}|${text}`); }
