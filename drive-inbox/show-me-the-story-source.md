# Show Me The Story — 第三方参考资料投送说明

投送时间：2026-10-06
投送方式：随 `drive-inbox/` 由 `.github/workflows/drive-sync.yml` 自动上传至 Google Drive `AgentFarm-回传/`

## 附件

- `show-me-the-story-v4.0.2-src.tar.gz` — 源码归档，176 条目，826 KB
  - SHA256 `600f48f896af26e454538afe867ca693577fd193d2f85fcae3a4582d7dc0d563`
  - 由 `git archive HEAD` 生成，不含 `.git` 历史，解压即根目录平铺

## 来源

- 仓库 https://github.com/Nigh/show-me-the-story
- 作者 `Nigh`（xianii），MIT License，Copyright (c) 2026 xianii
- 固定 commit `f790187373f23dbaaffa0838197e972a394960d3`（2026-10-04，Merge pull request #138 from Nigh/dev）
- 版本 v4.0.2；★613 / fork 75；Go 1.25.1 标准库 + Vite 5 / Svelte 4 / Tailwind 4 / DaisyUI 5
- 归档内保留原作者 `LICENSE` 与全部 docs，未做任何修改

## 用途（为什么拉进项目）

对标参照物，用于评估 AgentFarm 的 Agent 长文本生产链。它把「大纲 → 逐章写作 → 审查/重写 → 一致性校验」做成流水线，三处值得对照：

1. `internal/agent` — 多步生成的 Agent 编排与 prompt 分层，对照我们 actions/tool-cards 的 token 硬顶（1120）与 terse 分层
2. `internal/prose` + `internal/story` — 伏笔追踪、设定变更提案、带出处引用的事实抽取，对照我们的 `treesNear`/世界状态一致性思路
3. `AGENTS.md` / `DESIGN.md` / `PRODUCT.md` 三件套 — 把 Agent 工作流写成仓库根级规范的做法

## 解压与试跑

```bash
tar -xzf show-me-the-story-v4.0.2-src.tar.gz -C /path/to/dest
cd dest
task build
./show-me-the-story
# 浏览器打开 http://localhost:48090
```

前端构建需先 `cd frontend && npm install && npm run build`。

## 许可与合规

MIT，允许再分发与修改，唯一要求是保留本 `LICENSE` 声明——归档内已含原文，未删除、未改名。
不含任何凭据、无 `.env`、无 API key。归档内 `.github/workflows/` 属原作者 CI 配置，仅作阅读参考。
