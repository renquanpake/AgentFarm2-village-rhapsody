# AgentFarm2 · Hugging Face Spaces 部署指南（免费档，零银行卡）

> 主路径方案见 `docs/上线部署方案.md`；本文是 HF Spaces 的落地步骤。

## 适用

- 没有国际信用卡、没有 Oracle Cloud，用 GitHub 账号就能注册
- 免费 CPU Basic 档：2 vCPU / 16GB 内存 / 单次 48h 无访问休眠
- 适合 2-3 名玩家的小服（本项目上限 AF_MAX_PLAYERS=8）

## 1. 一次性准备（在你的开发机）

```bash
# 登录一次（让 git 能推送）
pip install huggingface_hub  # 或 npm i -g huggingface-cli
huggingface-cli login       # 贴 Access Token（https://huggingface.co/settings/tokens 生成）
```

## 2. 在 HF 上建 Space

进 `https://huggingface.co/new-space`：
- **Space name**：`agentfarm2`
- **SDK**：选 **Docker**
- **Hardware**：**CPU Basic**（免费）
- **Visibility**：Public（内测可改 Private）
- **Persistent storage**：开启（推荐 20GB，勾上防休眠的可用性）

建完得到推送地址 `https://huggingface.co/spaces/<用户名>/agentfarm2`。

## 3. 连接仓库并推送

```bash
cd /workspace   # 项目根
git remote add hf https://huggingface.co/spaces/<用户名>/agentfarm2
git push hf master --force
```

HF 会自动构建 `deploy/Dockerfile.hf`，跑起来后访问 `https://<用户名>-agentfarm2.hf.space`。

## 4. 必做：防休眠（HF 规则 48h 无访问就睡）

方案 A（推荐）：外部设备每 24 小时 ping 一次——

在**家里电脑**加一条 cron：

```bash
# 每天 08:00 唤醒一次
0 8 * * * curl -s -o /dev/null https://<用户名>-agentfarm2.hf.space/
```

或用 GitHub Actions 定时任务（仓库已有 .github/workflows/，加 schedule 即可）。

## 5. 存档备份（云端 /data 是持久卷，但服务器被回收即丢）

在**外部设备**（你自己的电脑）cron 每 6 小时：

```bash
# 把云端 /data/saves 拉回本地
rsync -avz <用户名>@hf-space:/data/saves ./af-backup/

# 再推一份回本仓库（可选）
cd af-backup && git add . && git commit -m "cloud saves backup" && git push origin master
```

HF 平台回收 Space 时会先发邮件，存档已有本地副本即可十分钟重建。

## 6. 模型配置

Space 是公开环境，**不要**把 .env 推上去。托管大脑需要在游戏里由玩家自己填指挥面板的「🤖 模型设置」——这就是我们已经实现的「玩家自带 Key 」设计，无 Key 时人类玩家照常玩，托管则明确拒绝启用。

## 7. 已知限制

| 项 | 状态 |
|---|---|
| 注册门槛 | 0（GitHub OAuth 直接登录） |
| 费用 | CPU Basic 永久免费 |
| 性能 | 2vCPU/16GB，够 ≤8 人小服 |
| 卡面立绘 | 已 COPY 进镜像（48MB），人设卡面板能正常显示 |
| 存档持久性 | Persistent Volume 持久；建议按 §5 做外部副本 |
| 域名 | 默认 hf.space 子域（自带 HTTPS）；绑自有域名需 Cloudflare（后续批） |

## 8. 生产检查清单

- [ ] HEALTHCHECK 通过（HF Space 页面绿色 Running）
- [ ] 客户端链接可点开，注册→进村→小地图三件套通
- [ ] `AF_MAX_PLAYERS` 默认 8——按服务器规模考虑改到 2~3
- [ ] 关闭 `AF_DEV_ENDPOINTS`（默认就是 0，不用动）
- [ ] 定期（如每周）拉一份存档回本地（§5）

---

## 与 GitHub Pages 的关系

- **GitHub Pages**：发客户端静态页（index.html + mod/），玩家打开链接——**入口走这个**
- **HF Spaces**：发服务端进程（本 Dockerfile），路由 `/ws` `/agent` `/af/*`
- 两者配合：玩家点 Pages 链接 → mod 里 SERVER 指向 HF Space 的 WS 地址 → 即玩
  （SERVER 在 client/mod/agentfarm.js 顶部，按部署域名改一处即可）