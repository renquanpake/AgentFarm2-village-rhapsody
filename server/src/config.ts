// config.ts —— 运行配置：环境变量 + 路径 + 常数（等价 legacy afserver.mjs 顶部）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 支持容器/云部署：AF_DATA_DIR 可把数据目录指到持久卷（如 Fly.io volume /data）
export const DATA_DIR = process.env.AF_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
export const CLIENT_ROOT = process.env.AF_CLIENT_DIR || path.resolve(__dirname, '..', '..', 'client');
export const SAVES_DIR = path.join(DATA_DIR, 'saves');
export const SEED_FILE = path.join(DATA_DIR, 'seed-villagedb.json');
export const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
export const PROVIDER_FILE = path.join(DATA_DIR, 'agent-provider.json');
export const BACKUP_SCRIPT = path.resolve(__dirname, '..', '..', 'tools', 'backup-saves.mjs');
// C8 美术资产（生图量化产物 + CC0 直采，仓库根 assets/；/af/art 端点交付给 mod）
export const ART_ROOT = process.env.AF_ART_DIR || path.resolve(__dirname, '..', '..', 'assets', 'generated');
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const PORT = Number(process.env.PORT || 8080);
// 存档位：AF_SLOT 环境变量或 --slot=N，默认 1
export const CURRENT_SLOT = Number(process.env.AF_SLOT || (process.argv.find(a => a.startsWith('--slot='))?.split('=')[1]) || 1);
// 作物 1 天 = 10 分钟真实时间（AF_GROW_MS 可调快测试）
export const GROW_DAY_MS = Number(process.env.AF_GROW_MS || 10 * 60 * 1000);
// WS 心跳保活周期（防隧道/NAT 空闲断开）
export const WS_HEARTBEAT_MS = Number(process.env.AF_WS_HEARTBEAT_MS || 30 * 1000);
// 同场景在线 > 10 分钟自动解锁 DM
export const DM_SCENE_COOLDOWN_MS = 10 * 60 * 1000;
// 一格 = 100px
export const AGENT_MOVE_STEP = 100;
// D1 导航执行确认闭环：等待客户端 arrive 上报实际落点的时间窗（超时回落盲推当前段）
export const NAV_ARRIVE_TIMEOUT_MS = Number(process.env.AF_NAV_ARRIVE_MS || 8000);
// D1 debug/回落分支开关：AF_NAV_DEBUG_BLIND=1 强制 120ms 逐格盲推（等价 legacy 行为）
export const NAV_DEBUG_BLIND = process.env.AF_NAV_DEBUG_BLIND === '1';

export function slotPaths(savesDir: string, slot: number): { slotDir: string; saveFile: string; metaFile: string } {
  const slotDir = path.join(savesDir, `slot${slot}`);
  return { slotDir, saveFile: path.join(slotDir, 'world.json'), metaFile: path.join(slotDir, 'meta.json') };
}
