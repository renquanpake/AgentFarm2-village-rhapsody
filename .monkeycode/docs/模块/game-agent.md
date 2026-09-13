# 模块：tools/game-agent.mjs

## 概述

LLM 驱动的独立 Agent 程序（469 行，Node CLI）。通过 WS `/agent?token=` 通道与 afserver 通信，`observe`（纯文本世界状态）→ LLM function calling 决策 → `act` 行动 → 循环。可独立运行，也可被 afserver 托管 spawn（`--rounds 999999`）。

**位置**: `tools/game-agent.mjs`

## CLI 参数

```
node tools/game-agent.mjs --token <AGENT_TOKEN> [--ws ws://host:8080/agent]
    [--rounds N] [--mode text|multimodal]
    [--llm-url https://api.deepseek.com/v1] [--llm-key <API_KEY>] [--llm-model deepseek-v4-flash]
    [--notes data/agent-notes/<账号>]
```

环境变量兜底：`AGENTFARM_TOKEN` / `AGENTFARM_WS` / `LLM_URL` / `LLM_KEY` / `LLM_MODEL`（默认 `deepseek-v4-flash`）。

## 主循环

1. `observe` 拉世界文本状态
2. LLM（OpenAI 兼容 function calling，每轮 15s 超时）决策，工具：
   - `game_observe` / `game_act` / `game_inbox` / `game_chat_log` / `game_dm`
   - `note_list` / `note_read` / `note_write`（笔记沙箱）
3. 执行 `act`（12 种动作，服务器权威判定）
4. 天数变化自动写 `日记/第N天.md`
5. 回到 1，直到 `--rounds` 耗尽

**多模态模式**（`--mode multimodal`）：额外截图上传给 LLM 描述。

## 笔记沙箱

`--notes` 子目录内仅 `.md` 文件可读写：
- 路径白名单正则 `^[\w\u4e00-\u9fa5.\-\/ ]+\.md$`，越界抛错
- 读取 20000 字节截断
- 人设文件 `agent.md`（由 `/af/agent-setup` 生成，6 种预设性格或自定义）

## 相关页面

- [接口 · Agent 通道](../INTERFACES.md)
- [专有概念/托管模型](../专有概念/托管模型.md)
- [模块/afserver](afserver.md)（spawn 方）
