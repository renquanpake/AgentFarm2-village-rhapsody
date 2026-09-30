// persistence/accounts.ts —— 账号系统（accounts.json：username -> 账号）
// 等价 legacy afserver.mjs 账号段：sha256 盐哈希、token 轮换、注册限流。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import type { Account } from '../types.ts';

export class AccountStore {
  accounts: Record<string, Account>;
  private file: string;
  /** 注册限流窗口（每秒滑窗） */
  regWin: number[] = [];

  constructor(file: string) {
    this.file = file;
    this.accounts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, Account> : {};
  }

  save(): void {
    writeFileSync(this.file, JSON.stringify(this.accounts, null, 1));
  }

  static hashPw(pw: string, salt: string): string {
    return createHash('sha256').update(salt + '::' + pw).digest('hex');
  }

  static genToken(): string {
    return randomBytes(16).toString('hex');
  }

  findAccountByToken(t: string | null): Account | null {
    if (!t) return null;
    for (const [uname, a] of Object.entries(this.accounts)) {
      if (a.token === t || a.agentToken === t) return a;
    }
    return null;
  }

  uidOfToken(t: string | null): string | null {
    const a = this.findAccountByToken(t);
    return a ? a.uid : null;
  }

  findAccountByUid(uid: string | null | undefined): Account | null {
    if (!uid) return null;
    for (const a of Object.values(this.accounts)) if (a.uid === uid) return a;
    return null;
  }

  usernameOf(acc: Account): string {
    return Object.keys(this.accounts).find(k => this.accounts[k] === acc) || acc.nick || acc.uid;
  }

  /** 注册：返回 { ok, msg?, account? }（限流 5/秒全局） */
  register(uname: string, pw: string): { ok: boolean; msg?: string; account?: Account } {
    if (this.accounts[uname]) return { ok: false, msg: 'exists' };
    const rNow = Date.now();
    this.regWin = this.regWin.filter(t => rNow - t < 1000);
    if (this.regWin.length >= 5) return { ok: false, msg: 'too many, slow down' };
    this.regWin.push(rNow);
    const salt = randomBytes(8).toString('hex');
    const uid = 'u' + randomBytes(6).toString('hex');
    const account: Account = { salt, hash: AccountStore.hashPw(pw, salt), uid, nick: uname, token: AccountStore.genToken(), createdAt: Date.now() };
    this.accounts[uname] = account;
    this.save();
    return { ok: true, account };
  }

  /** 登录：换新 token */
  login(uname: string, pw: string): { ok: boolean; msg?: string; account?: Account } {
    const existing = this.accounts[uname];
    if (!existing || existing.hash !== AccountStore.hashPw(pw, existing.salt)) return { ok: false, msg: 'bad login' };
    existing.token = AccountStore.genToken();
    this.save();
    return { ok: true, account: existing };
  }
}
