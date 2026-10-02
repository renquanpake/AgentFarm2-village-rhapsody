// cognition/provider-probe.ts —— Provider 连通性探针（登录接入引导用）
// 目的：让玩家在启动托管**之前**就能自己验证 API 地址/Key/模型名，并把失败原因
// 翻译成可执行的中文提示。llm.ts 的 chat() 遇错一律吞掉返回 null（为优雅降级设计），
// 拿不到真实错误码，无法用于诊断，故此处独立直连。
// 安全：Key 只出现在请求头，绝不进日志/事件/返回值。
import { log } from '../logging.ts';

export interface ProbeResult {
  ok: boolean;
  /** 面向玩家的中文结论 */
  msg: string;
  /** 补充信息（HTTP 状态码 / 响应片段），不回显任何凭据 */
  detail?: string;
  latencyMs?: number;
}

const PROMPT = '回复两个字：好的';

/** 直接向 OpenAI 兼容端点发一次极小请求，翻译失败原因 */
export async function probeProvider(url: string, key: string, model: string): Promise<ProbeResult> {
  const u = String(url || '').trim();
  const k = String(key || '').trim();
  const m = String(model || '').trim();
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, msg: 'API 地址需以 http(s):// 开头', detail: `收到：${u || '(空)'}` };
  }
  if (!k) return { ok: false, msg: '还没填 API Key', detail: 'Key 留空时若服务端已有配置会沿用，但首次配置必须填' };
  if (!m) return { ok: false, msg: '还没填模型名', detail: '例：deepseek-chat / gpt-4o-mini' };

  const base = u.replace(/\/+$/, '');
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
      body: JSON.stringify({
        model: m,
        messages: [{ role: 'user', content: PROMPT }],
        temperature: 0,
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
      const text = j?.choices?.[0]?.message?.content ?? '';
      log.write('info', 'provider-probe', '连通性通过', { model: m, latencyMs });
      return { ok: true, msg: '连接成功，托管可以用这个模型', detail: `模型回话：「${String(text).slice(0, 20)}」`, latencyMs };
    }
    const body = (await res.text().catch(() => '')).slice(0, 300);
    return { ok: false, ...(await explain(res.status, body)), latencyMs };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      msg: /abort|timeout/i.test(err) ? '连接超时（20 秒无响应）' : '连不上这个地址',
      detail: `${err}｜检查地址拼写、内网可达性与网络`,
      latencyMs: Date.now() - t0,
    };
  }
}

/** 把 HTTP 状态翻译成玩家能照做的提示 */
async function explain(status: number, body: string): Promise<{ msg: string; detail: string }> {
  const short = body.replace(/\s+/g, ' ').slice(0, 160);
  if (status === 401 || status === 403) {
    return { msg: 'API Key 被拒绝', detail: `HTTP ${status}：Key 无效、已过期或无该模型权限｜${short}` };
  }
  if (status === 404) {
    return { msg: '接口路径不存在（404）', detail: `HTTP ${status}：OpenAI 兼容地址通常要带 /v1 后缀，例如 https://example.com/v1｜${short}` };
  }
  if (status === 429) {
    return { msg: '被限流（429）', detail: `HTTP ${status}：稍等十几秒再试，或检查 Key 的额度｜${short}` };
  }
  if (status === 400) {
    return { msg: '请求被拒绝（400），多半是模型名不对', detail: `HTTP ${status}：核对模型名是否与该 Key 匹配｜${short}` };
  }
  if (status >= 500) {
    return { msg: `对方服务异常（${status}）`, detail: `HTTP ${status}：这是模型服务自己的问题，稍后重试｜${short}` };
  }
  return { msg: `连接失败（HTTP ${status}）`, detail: short };
}
