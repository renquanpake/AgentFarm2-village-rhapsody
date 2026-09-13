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
