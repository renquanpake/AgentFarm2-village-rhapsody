// test/unit/seed.test.ts —— 持久卷首次启动铺种（Railway startCommand 覆盖 CMD 的兜底）
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSeedData } from '../../src/persistence/seed.ts';

let root = '';
let seedDir = '';
let dataDir = '';

function write(rel: string, body: string): void {
  const p = path.join(seedDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'af-seed-'));
  seedDir = path.join(root, 'seed');
  dataDir = path.join(root, 'data');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensureSeedData：铺种', () => {
  it('补齐静态数据（含子目录），跳过运行时目录与凭据', () => {
    write('seed-villagedb.json', '{}');
    write('village-farm.json', '{"ok":1}');
    write('nav/nav-2.json', '{"nav":1}');
    write('saves/slot1/world.json', '{"old":1}');
    write('accounts.json', '{"secret":1}');
    write('accounts.json.bak', '{"secret":1}');
    write('agent-provider.json', '{"key":1}');
    write('art/raw/big.png', 'raw');
    write('art/manifest.json', '{"m":1}');

    const stats = ensureSeedData(dataDir, seedDir);

    expect(stats?.copied).toBe(4);
    expect(fs.existsSync(path.join(dataDir, 'nav/nav-2.json'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'art/manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'saves'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'accounts.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'agent-provider.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'art/raw'))).toBe(false);
  });

  it('已存在的存档/文件绝不覆盖，重复执行幂等', () => {
    write('nav/nav-2.json', 'new');
    const dest = path.join(dataDir, 'nav/nav-2.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'keep');

    ensureSeedData(dataDir, seedDir);
    expect(fs.readFileSync(dest, 'utf8')).toBe('keep');

    const again = ensureSeedData(dataDir, seedDir);
    expect(again?.copied).toBe(0);
    expect(fs.readFileSync(dest, 'utf8')).toBe('keep');
  });

  it('种子目录不存在时返回 null 且不抛错', () => {
    expect(ensureSeedData(dataDir, path.join(root, 'missing'))).toBeNull();
  });
});