// llm.ts —— OpenAI 兼容 LLM 客户端（C4）：fetch 直调，超时看门狗，无 key 时抛错（调用方降级）
// 支持按角色覆盖配置（档1：玩家自带供应商 key / 自定义 base_url / 模型）
import { llmConfig } from './config.ts';

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export interface LlmOpts {
  maxTokens?: number; timeoutMs?: number; temperature?: number;
  /** 玩家级覆盖：{ base_url, model, key, temperature } */
  override?: { base_url: string; model: string; key: string; temperature?: number };
}

export async function chat(messages: ChatMsg[], opts: LlmOpts = {}): Promise<string> {
  let cfg = llmConfig();
  if (opts.override) cfg = { ...cfg, ...opts.override };
  if (!cfg.key) throw new Error('NO_LLM_KEY');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${cfg.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: opts.temperature ?? cfg.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 300,
        messages
      }),
      signal: ac.signal
    });
    if (!res.ok) throw new Error('LLM_HTTP_' + res.status);
    const j = await res.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM_EMPTY');
    return String(content).trim();
  } finally {
    clearTimeout(timer);
  }
}

/** 请求 JSON 决策（容错解析：去 ``` 围栏、取首个 {…}） */
export async function chatJson<T>(messages: ChatMsg[], opts: LlmOpts = {}): Promise<T | null> {
  const s = await chat(messages, opts);
  const cleaned = s.replace(/```json|```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

/** 探测 OpenAI 兼容端点是否可达 + 模型是否支持多模态（列出 models，模型名常见多模态后缀判断） */
export async function probeProvider(cfg: { base_url: string; key: string; model: string }): Promise<{ ok: boolean; models?: string[]; reason?: string }> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(`${cfg.base_url.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const j = await res.json();
    const models = (j?.data || []).map((m: any) => m.id as string);
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** 多模态已移除：模型一律按纯文本处理 */
export function guessVisionCapable(_model: string): boolean {
  return false;
}