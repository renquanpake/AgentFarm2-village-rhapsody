// test/unit/onboarding.test.ts —— 登录接入引导（/af/onboarding + provider 探针 + 托管前置指引）
import { describe, it, expect } from 'vitest';
import { probeProvider } from '../../src/cognition/provider-probe.ts';

describe('provider 探针（玩家自查配置）', () => {
  it('地址格式不对时先就地给出可执行提示，不发请求', async () => {
    const r = await probeProvider('example.com', 'k', 'm');
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('http(s)://');
  });

  it('缺 Key 时提示填 Key', async () => {
    const r = await probeProvider('https://api.example.com/v1', '', 'm');
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('API Key');
  });

  it('缺模型名时提示填模型名', async () => {
    const r = await probeProvider('https://api.example.com/v1', 'k', '');
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('模型名');
  });

  it('401 翻译成「Key 被拒绝」而不是原始状态码', async () => {
    const r = await probeProvider('http://127.0.0.1:1/v1', 'k', 'm');
    // 端口 1 连不上 -> 网络类错误分支（不通向 401），但必须给出中文可执行结论
    expect(r.ok).toBe(false);
    expect(r.msg.length).toBeGreaterThan(0);
    expect(r.detail).toBeTruthy();
  });
});

describe('托管前置指引措辞', () => {
  it('managed.start 的无模型分支不再把服务端环境变量名当结论', async () => {
    // 直接读源码断言措辞：玩家可见结论必须是「去模型设置填」，环境变量名只能出现在 detail
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/cognition/managed.ts', import.meta.url), 'utf8');
    const line = src.split('\n').find(l => l.includes('还没配置模型'));
    expect(line).toBeTruthy();
    expect(line).toContain('模型设置');
    expect(line).not.toContain('无法启动托管');
  });
});

// 「配齐了」和「能用」是两件事：以前只看 url+key 是否存在就报"模型就绪"，
// 坏 Key 会一路骗到点启动托管才炸。探通记录必须在改地址/改模型后立刻失效。
describe('探通记录 verifiedAt', () => {
  const readHttp = () => import('node:fs').then(fs => fs.readFileSync(new URL('../../src/gateway/http.ts', import.meta.url), 'utf8'));

  it('探通成功才写 verifiedAt，普通保存不带', async () => {
    const src = await readHttp();
    expect(src).toContain('if (p.ok) save(Date.now())');
    // 普通保存只允许沿用"配置没变"的旧记录
    expect(src).toContain('prevFile.url === next.url && prevFile.model === next.model');
    expect(src).toContain('save(carriedVerifiedAt)');
  });

  it('onboarding 同时返回 providerReady 与 providerVerified，两者可不同', async () => {
    const src = await readHttp();
    expect(src).toContain('providerVerified, providerVerifiedAt: providerVerifiedAt || null');
    // 可托管仍只看配置齐不齐，避免用陈旧的验证记录把玩家挡在门外
    expect(src).toContain('const providerReady = !!(app.provider.url && app.provider.key)');
    expect(src).toContain('canHost: providerReady || playerKeyReady');
  });

  it('客户端把"已配置未验证"当成独立状态渲染', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../client/mod/agentfarm.js', import.meta.url), 'utf8');
    expect(src).toContain('模型已配置，未验证过连接');
    expect(src).toContain('还没验证过能不能连通');
    // 未验证时不提供"直接启动托管"，只给"先测试连接"
    expect(src).toContain("mkBtn('🔌 先测试连接'");
  });
});

// 同屏出现两遍同一行字，看起来就像渲染坏了：BR 胶囊承接了状态展示，
// 旧的 #af-agent-status 却仍以 body 直属节点常驻。
describe('常驻状态展示唯一化', () => {
  it('不再创建游离的 #af-agent-status', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../client/mod/agentfarm.js', import.meta.url), 'utf8');
    expect(src).not.toContain("status.id = 'af-agent-status'");
    expect(src).not.toContain("#af-agent-status {");
    expect(src).not.toContain("'af-agent-status', 'af-hud-agent'");
    // 唯一承载者仍在
    expect(src).toContain("chip.id = 'af-hud-agent'");
  });

  it('今日村况盒子只在有节日时出现，日期交给 HUD 时钟', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../client/mod/agentfarm.js', import.meta.url), 'utf8');
    const seg = src.slice(src.indexOf('function pollVillageToday'), src.indexOf('function pollVillageToday') + 1400);
    expect(seg).toContain('if (t.festival)');
    expect(seg).toContain("vd.style.display = 'none'");
    // 不再把日期写进村况盒子
    expect(seg).not.toContain("vd.innerHTML = '📅 第'");
  });
});