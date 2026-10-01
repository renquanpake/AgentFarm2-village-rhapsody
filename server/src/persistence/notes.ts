// persistence/notes.ts —— Agent 便签/收件箱/日记（data/agent-notes/<username>/）
// 等价 legacy afserver.mjs 的 inboxOf/pushInbox/agent-setup/agent-setup/diary 段。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { InboxEntry } from '../types.ts';
import { loadJson } from './state.ts';

/** 预设性格模板（agent-setup 用） */
export const AGENT_PRESETS: Record<string, string> = {
  '活泼开朗': '我是一个活泼开朗的村民，见人就打招呼，喜欢热闹，玩家让我帮忙我马上就去。',
  '沉稳寡言': '我话少但靠谱，说话简洁，做事踏实，是村里靠得住的人。',
  '好奇宝宝': '我什么都想看看，爱探索村庄每个角落，碰到新鲜事就想弄清楚。',
  '热心肠': '我乐于助人，玩家有要求马上去办，村里谁需要帮忙我都愿意搭把手。',
  '守财奴': '我精打细算，买东西前先问价货比三家，攒钱是我的乐趣。',
  '自由灵魂': '我随性自在，想干啥干啥，经常有突发奇想，讨厌被安排得明明白白。',
};

export class AgentNotes {
  private dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }

  private notesDir(username: string): string { return join(this.dataDir, 'agent-notes', username); }

  /** 收件箱文件（持久化；agent 不在线也不丢） */
  inboxOf(username: string): { file: string; arr: InboxEntry[] } {
    const f = join(this.notesDir(username), 'inbox.json');
    let arr = loadJson(f, []);
    if (!Array.isArray(arr)) arr = [];
    return { file: f, arr };
  }

  pushInbox(username: string, from: string, text: string): InboxEntry {
    const { file, arr } = this.inboxOf(username);
    const entry: InboxEntry = { from, text, at: Date.now() };
    arr.push(entry);
    while (arr.length > 50) arr.shift();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(arr, null, 1));
    console.log(`[inbox] ${from} -> ${username}: ${text.slice(0, 60)}`);
    return entry;
  }

  /** 拉取收件箱并清空（agent 端 {t:'inbox'}） */
  drainInbox(username: string): InboxEntry[] {
    const { file, arr } = this.inboxOf(username);
    const msgs = arr.map(m => ({ from: m.from, text: m.text, at: m.at }));
    if (arr.length) writeFileSync(file, '[]');
    return msgs;
  }

  /** 生成 agent.md 人设文件（按预设/自定义），返回生成结果 */
  agentSetup(username: string, opts: { personality?: string; name?: string; playstyle?: string; phrase?: string }): { name: string; personality: string } {
    const dir = this.notesDir(username);
    mkdirSync(dir, { recursive: true });
    const p = String(opts.personality || '').trim();
    const personality = AGENT_PRESETS[p] || p || AGENT_PRESETS['活泼开朗'];
    const name = String(opts.name || '').trim() || '无名村民';
    const md = `# agent.md —— 我的角色人设（agent 启动必读）\n\n## 我的名字\n${name}\n\n## 我的性格\n${personality}\n\n## 我的玩法偏好\n${String(opts.playstyle || '爱逛村庄、结识玩家、按时写日记。').trim()}\n\n## 我的自我介绍（对玩家说的话）\n你好呀，我是${name}！${personality.slice(0, 40)}…\n\n## 我的口头禅\n${String(opts.phrase || '交给我吧！').trim()}\n`;
    writeFileSync(join(dir, 'agent.md'), md, 'utf8');
    console.log(`[agent-setup] ${username} 性格=${p || '自定义'}`);
    return { name, personality };
  }

  /** 日记（只读）：列出该账号 agent 的日记 */
  diaryOf(username: string): { username: string; days: Array<{ file: string; title: string; content: string }> } {
    const diaryDir = join(this.notesDir(username), '日记');
    const out: { username: string; days: Array<{ file: string; title: string; content: string }> } = { username, days: [] };
    if (existsSync(diaryDir)) {
      for (const f of readdirSync(diaryDir).filter(x => x.endsWith('.md')).sort()) {
        const content = readFileSync(join(diaryDir, f), 'utf8');
        out.days.push({ file: f, title: f.replace(/\.md$/, ''), content: content.slice(0, 3000) });
      }
    }
    return out;
  }

  /** 资产日报（P2 银行）：一游戏日一份文件（日报/day-<N>.md），同日追加 */
  writeDailyReport(username: string, text: string, day: number): string {
    const dir = join(this.notesDir(username), '日报');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `day-${day}.md`);
    appendFileSync(f, `- ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${text}\n`, 'utf8');
    console.log(`[daily-report] ${username} 第 ${day} 天资产快照已存档`);
    return f;
  }

  /** 资产日报（只读，供 /af/diary 复用思路） */
  dailyReportOf(username: string): { username: string; days: Array<{ file: string; content: string }> } {
    const dir = join(this.notesDir(username), '日报');
    const out: { username: string; days: Array<{ file: string; content: string }> } = { username, days: [] };
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter(x => x.endsWith('.md')).sort()) {
        out.days.push({ file: f, content: readFileSync(join(dir, f), 'utf8').slice(0, 3000) });
      }
    }
    return out;
  }

  /** 规则文件同步到 Obsidian（可选配置 config/obsidian.json） */
  syncRulesToObsidian(rulesFile: string, obsidianVault: string | null): void {
    if (!obsidianVault || !existsSync(rulesFile)) return;
    mkdirSync(obsidianVault, { recursive: true });
    writeFileSync(join(obsidianVault, 'AgentFarm-游戏规则.md'), readFileSync(rulesFile, 'utf8'));
    console.log('[rules] 已同步游戏规则到 Obsidian：', obsidianVault);
  }
}
