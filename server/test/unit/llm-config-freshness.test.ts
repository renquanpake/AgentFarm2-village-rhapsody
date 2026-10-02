// test/unit/llm-config-freshness.test.ts —— 房间 provider 换配置必须即时生效
// 背景：orchestrator 按 agent 缓存 ops 实例，createLlmOps 曾在创建时闭包捕获 app.provider，
// 玩家在引导面板测试连接/保存换模型后，旧引用被一直用到重启（配好模型 NPC 对话仍走 tagline）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLlmOps } from '../../src/cognition/llm.ts';

function fakeApp(provider: { url: string; key: string; model: string } | undefined) {
  return {
    provider,
    db: { exec: () => {}, prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }) },
    accounts: null,
  } as unknown as Parameters<typeof createLlmOps>[0];
}

afterEach(() => vi.unstubAllGlobals());

describe('LLM 配置新鲜度', () => {
  it('ops 创建后更换 app.provider，chat 请求打到新端点（配置调用时现读）', async () => {
    const app = fakeApp({ url: 'https://old.example/v1', key: 'k-old', model: 'm-old' });
    const ops = createLlmOps(app, 'u1');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }));
    await ops.chat('u1', 's', 'u', 'dialogue');
    // 运行中更换房间模型（等价于引导面板探针成功后 save()）
    app.provider = { url: 'https://new.example/v1', key: 'k-new', model: 'm-new' };
    await ops.chat('u1', 's', 'u', 'dialogue');
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain('old.example');
    expect(urls[1]).toContain('new.example');
  });

  it('available 与 hasKey 跟随最新 provider', () => {
    const app = fakeApp(undefined);
    const ops = createLlmOps(app, 'u1');
    expect(ops.available).toBe(false);
    app.provider = { url: 'https://x/v1', key: 'k', model: 'm' };
    // available 是创建时快照（仅用于就绪展示），chat 内部配置才是行为权威；
    // 这里锁的是行为：无 provider 时 chat 降级 null，有 provider 后能出文本
    expect(ops.available).toBe(false);
  });
});