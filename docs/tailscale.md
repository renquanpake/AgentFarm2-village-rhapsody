# Tailscale 联机接入指南

零公网 IP、零月费、地址固定。你和朋友各装一次客户端，之后朋友直接访问你的 Tailscale 内网 IP 进游戏。

## 1. 房主 + 玩家都装 Tailscale

- 官网 https://tailscale.com 下载对应系统客户端（Windows/macOS/Linux/Android/iOS）
- 登录同一个 Tailscale 账号（免费，最多 100 台设备）
- 登录成功会看到一个 `100.x.x.x` 的内网 IP，记下来

## 2. 房主启动服务器

```bash
cd AgentFarm2-village-rhapsody
AF_NO_TUNNEL=1 PORT=8080 node server/afserver.mjs
```

`AF_NO_TUNNEL=1` 跳过 cloudflared，避免隧道抢占 8080 干扰本地连接。

房主自己的 Tailscale IP 在登录页或终端里查：

```bash
# 房主终端
tailscale ip
```

输出如 `100.123.45.67`，把这个 IP 告诉朋友。

## 3. 朋友进游戏

1. 打开浏览器，访问 `http://100.123.45.67:8080/`（房主 Tailscale IP）
2. 游戏自动加载，登录界面选「我是房主」或「加入房间」
3. 点「加入房间」→ 手动输入地址 `http://100.123.45.67:8080` → 连接

之后每次进游戏直接访问同一个 IP，地址永不变化。

## 网络要求

- 双方都能正常上网（Tailscale 走加密隧道，无需端口映射）
- 部分严格企业防火墙可能阻断 Tailscale 的 WireGuard 协议，家用宽带/手机热点无影响

## 存档永不丢

服务器每 10 分钟自动 `git commit` `data/saves/`。要推到 GitHub 私有仓库，配置 token：

```bash
# 在仓库根目录
git config --global credential.helper store
# 首次 push 时输入 GitHub 用户名 + 个人访问令牌（PAT）
node tools/backup-saves.mjs --push
```

之后服务端定时器会自动推送。没配 token 时仅本地 commit，不影响游戏。

## 4. 部署验收清单（F4）

本机/内网验收按序执行，全过即 F4 达标：

### 4.1 本地单机（先做）

```bash
# 房主机器
cd AgentFarm2-village-rhapsody
AF_NO_TUNNEL=1 PORT=8080 node server/afserver.mjs
```

浏览器开 `http://localhost:8080/`，逐条确认：

| # | 项 | 预期 |
|---|----|------|
| 1 | 登录进游戏 | 村景可移动（导航寻路正常） |
| 2 | 交易 | `/af/economy`（feeMultiplier/inflationIndex）+ `/af/market/{id}`（订单簿 7 日 OHLC）可用 |
| 3 | 画报 | `/af/daily-report` 返回当日聚合（eventCount/byType/players 榜/highlights 定位点/reportHash） |
| 4 | 影子 | `/af/shadow` 返回影子实例指标（前 14 日观察期内数据逐日增长） |
| 5 | NPC/动物/天气 | `/af/npc-schedule` 返回当前时刻全 NPC 决策快照（快时钟下幂等不换位属正常；生产日钟下换位时推 `npc_move`）+ `/af/animals` 可用 + `/af/calendar` 天气/节日 |
| 6 | LLM（配了 Key 时） | `POST /af/llm-key` 保存 Key；`/af/llm-usage` 有计量记录；玩家对话/规划走 Key |

### 4.2 双机联机（Tailscale）

1. 两台机器均装 Tailscale 且同账号，`tailscale ip` 各取 `100.x.x.x`
2. 房主按第 2 节启动（`AF_NO_TUNNEL=1`），把自己的 `100.x.x.x:8080` 给玩家
3. 玩家浏览器直接访问该地址（无需端口映射/公网），完成 4.1 的 1-4 项
4. 双向操作可见（玩家动作物/交易，房主侧世界同步步推进）

### 4.3 回退与排障

- 玩家连不上：先 `tailscale ping 100.x.x.x` 验证隧道；再检查房主是否加了 `AF_NO_TUNNEL=1`（cloudflared 抢 8080 会干扰）
- 企业网阻断 WireGuard：换手机热点验证；仍失败属 4.1 网络要求一节，非代码问题
- 存档核对：`git -C . log --oneline -5 data/saves` 应见自动 commit
