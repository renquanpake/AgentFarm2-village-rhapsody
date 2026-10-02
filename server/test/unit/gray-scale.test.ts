import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { grayScaleOf, featureEnabled } from '../../src/world/gray-scale.js';

describe('E 包：灰度开关', () => {
  it('灰度关：所有特性对所有人开放', () => {
    const g = grayScaleOf({});
    expect(featureEnabled(g, 'userA', 'lease')).toBe(true);
  });

  it('灰度开 + 白名单：命中者开放，未命中者关闭', () => {
    const g = grayScaleOf({ AF_GRAYSCALE_ON: '1', AF_GRAYSCALE_USERS: 'u1,u2' });
    expect(featureEnabled(g, 'u1', 'lease')).toBe(true);
    expect(featureEnabled(g, 'u2', 'lease')).toBe(true);
    expect(featureEnabled(g, 'u3', 'lease')).toBe(false);
  });

  it('特性级开关：AF_FEATURE_OFF_<X>=1 单独关闭', () => {
    const g = grayScaleOf({ AF_GRAYSCALE_ON: '1', AF_GRAYSCALE_USERS: '*' });
    const env = { AF_FEATURE_OFF_LEASE: '1' };
    expect(featureEnabled(g, 'u1', 'lease', env)).toBe(false);
    expect(featureEnabled(g, 'u1', 'claims', env)).toBe(true);
  });
});
