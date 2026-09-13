# 模块：tools/backup-saves.mjs

## 概述

存档 git 自动备份脚本（94 行）。被 afserver 定时器每 10 分钟调用，也可手动执行。把 `data/saves/` 增量提交到 git（有凭据则 push 到 GitHub），充当存档异地容灾。

**位置**: `tools/backup-saves.mjs`

## 工作流

```
AF_NO_GIT=1 ? 直接退出（容器走持久卷）
  : 幂等锁检查（.backup-lock，10min 过期）
  : git add --sparse data/saves/
  : 无改动 → 跳过
  : commit（chore(saves): auto backup）
  : hasPushCredential ? push : 仅本地 commit
```

## 关键设计

- **`--sparse`**：仓库是 sparse-checkout（只含 server/deploy/docs/client 等），`git add` 必须带 `--sparse` 才能正确暂存 `data/saves/`（否则 add 被 sparse 规则过滤）
- **凭据探测（hasPushCredential）**：dry-run 一次 push，判 401/403/空输出 → 无凭据，降级本地 commit（游戏永不因备份失败阻塞）
- **幂等锁** `data/.backup-lock`：定时器与手动执行互斥，10 分钟自动过期清理
- 凭据走 git credential helper / `.netrc`，token 不落仓库

## 手动触发

```bash
node tools/backup-saves.mjs --push
```

## 相关页面

- [专有概念/自动备份](../专有概念/自动备份.md)
- [开发者指南 · 配置 GitHub 自动备份](../DEVELOPER_GUIDE.md)
