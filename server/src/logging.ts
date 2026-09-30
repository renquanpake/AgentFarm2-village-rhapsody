// logging.ts —— 结构化日志 + 内存指标环形缓冲（设计 M6.5；零依赖：JSON 行日志 + 环形缓冲）
export interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  msg: string;
  [k: string]: unknown;
}

const RING_CAP = 500;

export class StructuredLog {
  private ring: LogEntry[] = [];
  private seq = 0;

  write(level: LogEntry['level'], module: string, msg: string, fields?: Record<string, unknown>): void {
    const e: LogEntry = { ts: Date.now(), level, module, msg, ...fields };
    this.ring.push(e);
    if (this.ring.length > RING_CAP) this.ring.shift();
    this.seq++;
    // JSON 行日志（stdout 缓冲不影响；管理后台可读取环形缓冲）
    const line = JSON.stringify(e);
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    out(`[${level}] ${line}`);
  }

  tail(n = 50): LogEntry[] {
    return this.ring.slice(-n);
  }

  /** 管理后台：内存指标 + 日志尾部 */
  snapshot(count = 50): { memory: NodeJS.MemoryUsage; logRing: number; entries: LogEntry[] } {
    return { memory: process.memoryUsage(), logRing: this.ring.length, entries: this.tail(count) };
  }
}

/** 全局实例（组合根创建，各模块注入） */
export const log = new StructuredLog();
