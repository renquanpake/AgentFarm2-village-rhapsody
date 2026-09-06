// config.ts —— 加载配置表（data/*.json）与 LLM 配置，全部读文件不硬编码
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const MAPS_DIR = path.join(ROOT, 'client', 'public', 'maps');
export const MEMORY_DIR = path.join(ROOT, 'memory');
export const DOCS_DIR = path.join(ROOT, 'docs');
export const SAVE_DIR = path.join(__dirname, '..', 'save');
export const STATIC_DIR = path.join(__dirname, '..', 'public', 'client'); // 生产静态（vite build 产物）

/** 可选 Obsidian 记忆库路径（config/obsidian.json: {"vault": "D:\\...\\vault"}），用于分发规则文件 */
export function obsidianDir(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'obsidian.json'), 'utf8'));
    return typeof j?.vault === 'string' && j.vault ? j.vault : null;
  } catch { return null; }
}

function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8'));
}

export const data = {
  items: loadJson<any[]>('items.json'),
  plants: loadJson<any[]>('plants.json'),
  recipes: loadJson<any[]>('recipes.json'),
  buildings: loadJson<any[]>('buildings.json'),
  shop: loadJson<any[]>('shop.json'),
  fish: loadJson<any[]>('fish.json'),
  mine: loadJson<any[]>('mine.json'),
  npcs: loadJson<any[]>('npcs.json'),
  scenes: loadJson<any[]>('scenes.json'),
  tasks: loadJson<any>('tasks.json'),
  social: loadJson<any>('social.json'),
  balance: loadJson<any>('balance.json'),
};

export const itemNames: Record<string, string> = {};
for (const it of data.items) if (it?.id) itemNames[String(it.id)] = it.name;

export const scenesById: Record<number, any> = {};
for (const s of data.scenes) scenesById[s.id] = s;

export const recipesById: Record<number, any> = {};
for (const r of data.recipes) recipesById[r.id] = r;

// LLM 配置（key 走环境变量，文件内不落密钥）
export function llmConfig() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'llm.json'), 'utf8'));
  const tier = process.env.LLM_TIER || raw.default || 'production';
  const cfg = raw.tiers?.[tier] || raw[tier] || raw;
  const key = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.AGNES_API_KEY || '';
  return { base_url: cfg.base_url, model: cfg.model, temperature: cfg.temperature ?? 0.7, key };
}

export const balance = data.balance as {
  hunger: { max: number; slow_loss_below: number; slow_hp_per_min: number; zero_hp_per_sec: number; food_restore_range: [number, number] };
  time: { day_cycle_minutes: number; night_start_hour: number };
  economy: { start_gold: number };
};