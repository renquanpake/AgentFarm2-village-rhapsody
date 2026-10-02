// cognition/managed.ts —— 托管 Agent 生命周期（服务器 spawn tools/game-agent.mjs）+ 玩家操作打断/活动广播
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from '../app.ts';
import type { Account } from '../types.ts';
import { AccountStore } from '../persistence/accounts.ts';
import { log } from '../logging.ts';
import { routeForAgent } from './router.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/cognition -> server -> 仓库根（tools/game-agent.mjs 与 agent-notes 所在）
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export interface Provider { url: string; key: string; model: string; }

/** LLM provider 解析：env 优先，其次 provider 配置文件，默认 deepseek-v4-flash */
export function resolveProvider(env: NodeJS.ProcessEnv, providerFile: { url?: string; key?: string; model?: string }): Provider {
  const url = env.AF_LLM_URL || env.LLM_URL || providerFile.url || '';
  const key = env.AF_LLM_KEY || env.LLM_KEY || providerFile.key || '';
  const model = env.AF_LLM_MODEL || env.LLM_MODEL || providerFile.model || 'deepseek-v4-flash';
  return { url, key, model };
}

export class ManagedAgentManager {
  private children = new Map<string, ChildProcess>();
  private app: App;

  constructor(app: App) { this.app = app; }

  isRunning(uid: string): boolean {
    const c = this.children.get(uid);
    return !!c && !c.killed;
  }

  start(acc: Account): { ok: boolean; msg?: string; detail?: string; source?: string } {
    const app = this.app;
    // M7：优先玩家自带 Key（解密到进程内存注入；服务端零池化密钥），回落全局 provider
    let p: Provider = app.provider;
    let source = 'global-provider';
    try {
      const routed = routeForAgent(app.db, { url: app.provider.url, key: app.provider.key, model: app.provider.model }, acc.uid, 'plan');
      if (routed.source === 'player-key') {
        p = { url: routed.baseUrl, key: routed.key, model: routed.model };
        source = 'player-key';
      }
    } catch { /* 回落全局 provider */ }
    if (!p.url || !p.key) {
      // 原实现直接回「服务端未配置 AF_LLM_URL 和 AF_LLM_KEY」——那是服务端环境变量名，
      // 玩家既改不了也不知道下一步。改为给可执行指引，技术细节放 detail。
      return {
        ok: false,
        msg: source === 'player-key'
          ? '你的 LLM Key 没能取出来（密钥保管不可用），请重新保存一次自带 Key'
          : '还没配置模型：点「🤖 模型设置」填 API 地址、API Key、模型名，保存后再启动托管',
        detail: `no provider: url=${p.url ? 'set' : 'empty'} key=${p.key ? 'set' : 'empty'}（服务端环境变量 AF_LLM_URL / AF_LLM_KEY 亦为空）`,
      };
    }
    const existing = this.children.get(acc.uid);
    if (existing && !existing.killed) return { ok: false, msg: '该账号的 Agent 已在运行中' };
    let token = acc.agentToken;
    if (!token) {
      token = AccountStore.genToken();
      acc.agentToken = token;
      this.app.accounts.save();
    }
    const username = this.app.accounts.usernameOf(acc);
    const child = spawn(process.execPath, [
      path.join(REPO_ROOT, 'tools', 'game-agent.mjs'),
      '--token', token,
      '--rounds', '999999',
      '--notes', path.join(this.app.dataDir, 'agent-notes', username),
    ], {
      cwd: REPO_ROOT,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, LLM_URL: p.url, LLM_KEY: p.key, LLM_MODEL: p.model },
    }) as unknown as ChildProcess;
    this.children.set(acc.uid, child);
    child.once('exit', () => { if (this.children.get(acc.uid) === child) this.children.delete(acc.uid); });
    log.write('info', 'managed', '启动托管 agent 子进程', { uid: acc.uid, model: p.model, source });
    return { ok: true, source };
  }

  stop(uid: string): { ok: boolean; msg?: string } {
    const child = this.children.get(uid);
    if (!child) return { ok: false, msg: '该账号没有由服务器启动的 Agent' };
    child.kill();
    this.children.delete(uid);
    return { ok: true };
  }

  /** 进程退出时清理所有托管子进程 */
  killAll(): void {
    for (const c of this.children.values()) { try { c.kill(); } catch { /* ignore */ } }
    this.children.clear();
  }
}

// ---------- 玩家操作流（打断 agent）与活动状态广播 ----------

/** 玩家可见的 Agent 活动状态（3s 节流） */
export function publishAgentActivityGlobal(app: App, uid: string, text: string): void {
  const s = app.state.actState.get(uid) || { at: 0, text: '' };
  const now = Date.now();
  if (text === s.text && now - s.at < 3000) return;
  s.at = now;
  s.text = text;
  app.state.actState.set(uid, s);
  const p = app.state.online.get(uid);
  if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'agent_activity', activity: text }));
}

/** 记录玩家操作（cap 10），5s 节流推 player_op 给在线 agent，并切活动状态 */
export function notePlayerOp(app: App, uid: string, kind: string, text: string): void {
  const arr = app.state.playerOps.get(uid) || [];
  arr.push({ at: Date.now(), kind, text });
  while (arr.length > 10) arr.shift();
  app.state.playerOps.set(uid, arr);
  const now = Date.now();
  if (now - (app.state.lastOpPush.get(uid) || 0) < 5000) return;
  app.state.lastOpPush.set(uid, now);
  const s = app.agentSockets.get(uid);
  if (s) for (const w of s) if (w.readyState === 1) w.send(JSON.stringify({ t: 'player_op', kind, text }));
  if (s && s.size) publishAgentActivityGlobal(app, uid, text || '你（玩家）在游戏里活动，Agent 已让位等你');
}
