// gateway/tunnel.ts —— 内网穿透（cloudflared 快速隧道优先，localtunnel 兜底，最后局域网）
// 零现金部署：cloudflared 免费隧道 + 6 位房间码，朋友浏览器直连。
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from '../app.ts';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function genRoomCode(): string {
  // 6 位纯数字码（0-9），与 /af/join-room 和客户端 /^\d+$/ 校验对齐
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

function findCloudflaredBin(): string {
  // 优先用仓库内自带的二进制（server/cloudflared.exe 或 server/cloudflared），其次 PATH 全局命令
  const localBin = join(SERVER_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(localBin)) return localBin;
  return 'cloudflared';
}

// cloudflared 快速隧道（*.trycloudflare.com，无需账号/域名）。timeoutMs 内拿不到公网地址视为失败
function startCloudflared(port: number, timeoutMs = 30000): Promise<{ url: string | null; proc: ChildProcess | null }> {
  return new Promise(resolve => {
    const bin = findCloudflaredBin();
    let proc: ChildProcess;
    try {
      // --protocol http2 走 TCP 7844：QUIC(UDP) 在部分网络/防火墙下不通，http2 兼容性最好
      proc = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ url: null, proc: null });
      return;
    }
    let settled = false;
    let finalUrl: string | null = null;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      finalUrl = url;
      clearTimeout(timer);
      resolve({ url, proc: url ? proc : null });
    };
    const onData = (buf: unknown) => {
      const m = String(buf).match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i);
      if (m) finish(m[0]);
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData); // cloudflared 把隧道地址打在 stderr
    proc.on('error', () => finish(null));
    proc.on('exit', () => finish(null));
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
    void finalUrl;
  });
}

/** 启动穿透：cloudflared -> localtunnel -> 局域网。填充 app.roomCodes / app.tunnelUrl / app.roomCode。 */
export async function startTunnel(app: App, port: number): Promise<void> {
  const roomCode = genRoomCode();
  app.roomCode = roomCode;
  // 1) cloudflared 快速隧道：稳、支持 WebSocket、国内可达性好
  const { url: cfUrl, proc } = await startCloudflared(port);
  if (cfUrl && proc) {
    app.tunnelUrl = cfUrl;
    app.tunnelProc = proc;
    app.roomCodes.set(roomCode, cfUrl);
    console.log('[tunnel] cloudflared 隧道成功！');
    console.log(`[tunnel] 公网地址: ${cfUrl}`);
    console.log(`[tunnel] 房间码: ${roomCode}`);
    console.log('[tunnel] 朋友浏览器打开公网地址即可加入（快速隧道地址每次重启会变，记得发给朋友）');
    proc.on('exit', () => {
      if (app.tunnelUrl && app.tunnelUrl.includes('.trycloudflare.com')) {
        app.tunnelUrl = null;
        app.roomCode = null;
        console.log('[tunnel] cloudflared 进程退出，隧道已断');
      }
    });
    return;
  }
  // 2) localtunnel 兜底
  try {
    const lt = (await import('localtunnel')).default as (opts: { port: number; subdomain: string }) => Promise<{ url: string; on: (ev: string, cb: () => void) => void }>;
    const info = await lt({ port, subdomain: 'afarm-' + genRoomCode() });
    app.tunnelUrl = info.url;
    app.roomCodes.set(roomCode, info.url);
    console.log('[tunnel] localtunnel 兜底穿透成功（稳定性一般）');
    console.log(`[tunnel] 朋友输入房间码 ${roomCode} 即可加入`);
    info.on('close', () => {
      app.tunnelUrl = null;
      app.roomCode = null;
      console.log('[tunnel] 隧道已关闭');
    });
    return;
  } catch (e) {
    console.log(`[tunnel] localtunnel 兜底也失败: ${(e as Error).message}`);
  }
  // 3) 局域网模式
  app.tunnelUrl = null;
  app.roomCodes.set(roomCode, '');
  console.log(`[tunnel] 仍在局域网模式，朋友可通过 IP:${port} 加入`);
}

/** 清理隧道进程（进程退出/信号时调用） */
export function stopTunnel(app: App): void {
  try { if (app.tunnelProc) app.tunnelProc.kill(); } catch { /* ignore */ }
  app.tunnelProc = null;
}
