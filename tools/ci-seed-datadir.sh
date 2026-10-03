#!/usr/bin/env bash
# tools/ci-seed-datadir.sh —— 给隔离的 AF_DATA_DIR 铺静态游戏数据（CI 门3/门9 用）
#
# AF_DATA_DIR 是整目录替换：空临时目录会让 Tables 回落空数组（npcs/items/collision/spawns…），
# 表现为协议回归里「没有这个 NPC」。saves/accounts 仍留在临时目录，测试不污染仓库。
# 只复制 git 跟踪的 data/** 文件，本地遗留的 saves/accounts/备份不会被带进去。
set -euo pipefail

TARGET="${1:?用法: ci-seed-datadir.sh <AF_DATA_DIR>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$TARGET"

cd "$ROOT"
count=0
while IFS= read -r -d '' f; do
  rel="${f#data/}"
  # 跳过存档位与账号文件：这两类必须是测试自己生成的干净数据
  case "$rel" in
    saves/*|accounts.json|accounts.json.bak) continue ;;
  esac
  mkdir -p "$TARGET/$(dirname "$rel")"
  cp "$f" "$TARGET/$rel"
  count=$((count + 1))
done < <(git ls-files -z data)

echo "[ci-seed-datadir] 已复制 $count 个跟踪数据文件（跳过 saves/accounts）-> $TARGET"