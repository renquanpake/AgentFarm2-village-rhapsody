// test/unit/m7.test.ts —— M7 玩家自带 Key：密钥保管(AES-256-GCM) / 双档路由 / 结果缓存 / 计量
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openDb } from '../../src/persistence/db.ts';
import {
  keyvaultAvailable, upsertLlmKey, readLlmKey, getDecryptedKey,
  recordUsage, usageSummary, encryptKey, decryptKey,
} from '../../src/persistence/keyvault.ts';
import {
  routeForAgent, ResultCache, stabilizePrefix, hashStr, meteredRoute, TIER_BY_TASK,
} from '../../src/cognition/router.ts';

const KEY64 = 'a'.repeat(64); // 32 字节 hex

function newDb() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'af-m7-'));
  const db = openDb(path.join(d, 'm7.db'));
  (db as unknown as { __tmp?: string }).__tmp = d;
  return db;
}
function closeDb(db: DatabaseSync) {
  const d = (db as unknown as { __tmp?: string }).__tmp;
  db.close();
  if (d) fs.rmSync(d, { recursive: true, force: true });
}

describe('keyvault 可用性', () => {
  it('未配置 AF_AES_KEY 时不可用，upsert 返回 no-cipher', () => {
    delete process.env.AF_AES_KEY;
    expect(keyvaultAvailable()).toBe(false);
    const db = newDb();
    expect(upsertLlmKey(db, { accountUid: 'u1', baseUrl: 'https://x', model: 'm' }, 'sk-test')).toBe('no-cipher');
    closeDb(db);
  });
});

describe('keyvault 加解密往返', () => {
  beforeAll(() => { process.env.AF_AES_KEY = KEY64; });
  afterAll(() => { delete process.env.AF_AES_KEY; });

  it('encryptKey/decryptKey 往返一致', () => {
    const { cipher, iv, tag } = encryptKey('sk-super-secret-123');
    expect(decryptKey(cipher, iv, tag)).toBe('sk-super-secret-123');
    // 密文不等于明文
    expect(cipher.toString()).not.toContain('sk-super-secret');
  });

  it('upsert -> read(脱敏) -> getDecryptedKey 还原', () => {
    const db = newDb();
    const r = upsertLlmKey(db, { accountUid: 'u2', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', tierMap: { compact: 'lite', flagship: 'pro' }, priceHintCpm: 42 }, 'sk-abc');
    expect(r).toBe('ok');
    const v = readLlmKey(db, 'u2')!;
    expect(v.baseUrl).toBe('https://api.deepseek.com');
    expect(v.tierMap).toEqual({ compact: 'lite', flagship: 'pro' });
    expect(v.hasCipher).toBe(true);
    expect(v).not.toHaveProperty('key'); // 脱敏：明文不出接口
    const d = getDecryptedKey(db, 'u2')!;
    expect(d.key).toBe('sk-abc');
    closeDb(db);
  });

  it('不带新 key 更新 url/model 时保留既有密文', () => {
    const db = newDb();
    upsertLlmKey(db, { accountUid: 'u3', baseUrl: 'https://old', model: 'm1' }, 'sk-orig');
    upsertLlmKey(db, { accountUid: 'u3', baseUrl: 'https://new', model: 'm2' }); // 无 key
    const d = getDecryptedKey(db, 'u3')!;
    expect(d.baseUrl).toBe('https://new');
    expect(d.key).toBe('sk-orig'); // 旧密钥仍可用
    closeDb(db);
  });

  it('带新 key 覆盖旧密文', () => {
    const db = newDb();
    upsertLlmKey(db, { accountUid: 'u4', baseUrl: 'https://x', model: 'm' }, 'sk-old');
    upsertLlmKey(db, { accountUid: 'u4', baseUrl: 'https://x', model: 'm' }, 'sk-new');
    expect(getDecryptedKey(db, 'u4')!.key).toBe('sk-new');
    closeDb(db);
  });
});

describe('双档路由', () => {
  beforeAll(() => { process.env.AF_AES_KEY = KEY64; });
  afterAll(() => { delete process.env.AF_AES_KEY; });

  const GLOBAL = { url: 'https://global', key: 'gk', model: 'gm' };

  it('无玩家 Key 时回落 global-provider', () => {
    const db = newDb();
    const r = routeForAgent(db, GLOBAL, 'u_none', 'plan');
    expect(r.source).toBe('global-provider');
    expect(r.model).toBe('gm');
    closeDb(db);
  });

  it('无任何 Key 时为 none（降级运行）', () => {
    const db = newDb();
    const r = routeForAgent(db, { url: '', key: '', model: '' }, 'u_none', 'plan');
    expect(r.source).toBe('none');
    closeDb(db);
  });

  it('玩家 Key + tierMap 按任务档位选模型', () => {
    const db = newDb();
    upsertLlmKey(db, { accountUid: 'u5', baseUrl: 'https://p', model: 'default', tierMap: { compact: 'small', flagship: 'big' } }, 'sk-p');
    expect(routeForAgent(db, GLOBAL, 'u5', 'perceive').model).toBe('small'); // perceive -> compact
    expect(routeForAgent(db, GLOBAL, 'u5', 'plan').model).toBe('big');       // plan -> flagship
    expect(routeForAgent(db, GLOBAL, 'u5', 'dialogue').source).toBe('player-key');
    closeDb(db);
  });

  it('任务->档位映射正确', () => {
    expect(TIER_BY_TASK.perceive).toBe('compact');
    expect(TIER_BY_TASK.embed).toBe('compact');
    expect(TIER_BY_TASK.plan).toBe('flagship');
    expect(TIER_BY_TASK.write).toBe('flagship');
  });
});

describe('结果缓存（M7 节省 Key 额度）', () => {
  it('命中与过期', () => {
    const c = new ResultCache({ ttlMs: 50 });
    c.set('k', { a: 1 });
    expect(c.get('k').hit).toBe(true);
    expect(c.get('k').value).toEqual({ a: 1 });
    // 用短 ttl 验证过期分支（Atomics.wait 同步阻塞 5ms）
    const c2 = new ResultCache({ ttlMs: 1 });
    c2.set('k2', 42);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    expect(c2.get('k2').hit).toBe(false);
  });

  it('超容量按插入序淘汰', () => {
    const c = new ResultCache({ maxEntries: 2 });
    c.set('a', 1); c.set('b', 2); c.set('c', 3); // a 被淘汰
    expect(c.get('a').hit).toBe(false);
    expect(c.get('c').hit).toBe(true);
  });

  it('stabilizePrefix 对记忆段顺序不敏感（前缀稳定化）', () => {
    const a = stabilizePrefix('SYS', ['mem1', 'mem2', 'mem3']);
    const b = stabilizePrefix('SYS', ['mem3', 'mem1', 'mem2']);
    expect(a).toBe(b);
    expect(hashStr(a)).toHaveLength(16);
  });
});

describe('计量（llm_usage）', () => {
  beforeAll(() => { process.env.AF_AES_KEY = KEY64; });
  afterAll(() => { delete process.env.AF_AES_KEY; });

  it('recordUsage + usageSummary 汇总', () => {
    const db = newDb();
    recordUsage(db, { accountUid: 'u6', agentUid: 'u6', taskType: 'plan', tier: 'flagship', tokensIn: 100, tokensOut: 50, usdHint: 0.001 });
    recordUsage(db, { accountUid: 'u6', agentUid: 'u6', taskType: 'perceive', tier: 'compact', tokensIn: 10, tokensOut: 5, cached: true });
    recordUsage(db, { accountUid: 'u6', agentUid: 'u6', taskType: 'write', tier: 'flagship', tokensIn: 30, tokensOut: 15 });
    const s = usageSummary(db, 'u6');
    expect(s.calls).toBe(3);
    expect(s.tokensIn).toBe(140);
    expect(s.tokensOut).toBe(70);
    expect(s.cached).toBe(1);
    expect(s.byTier).toEqual({ flagship: 2, compact: 1 });
    expect(s.byTask).toEqual({ plan: 1, perceive: 1, write: 1 });
    closeDb(db);
  });

  it('meteredRoute 把命中/未命中计入 cached', () => {
    const db = newDb();
    upsertLlmKey(db, { accountUid: 'u7', baseUrl: 'https://p', model: 'm' }, 'sk-7');
    const G = { url: 'https://global', key: 'gk', model: 'gm' };
    const cache = new ResultCache();
    const mr1 = meteredRoute(db, G, 'u7', 'u7', 'plan', 'reqtext', cache);
    expect(mr1.hit).toBe(false);
    mr1.record(10, 5);
    cache.set(mr1.cacheKey, { answer: 1 });
    const mr2 = meteredRoute(db, G, 'u7', 'u7', 'plan', 'reqtext', cache);
    expect(mr2.hit).toBe(true);
    mr2.record(10, 5);
    const s = usageSummary(db, 'u7');
    expect(s.calls).toBe(2);
    expect(s.cached).toBe(1); // 第二次命中缓存
    closeDb(db);
  });
});
