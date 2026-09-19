#!/usr/bin/env bash
# =============================================================================
# GameRank 服务器一键更新脚本
# 用法（在服务器上，任何目录执行，或用绝对路径调用）：
#   bash /home/god/gamerank/update.sh
# 或以 root 身份简化常用更新：
#   sudo bash /home/god/gamerank/update.sh
#
# 前置要求：
#   - /home/god/gamerank 已 init 为一个 git 仓库，并关联 origin（GitHub）
#   - 服务器 ~/.ssh/git_deploykey 已加入 GitHub 仓库的 Deploy Key（只读即可）
#   - gamerank 后端已注册为 systemd 服务（gamerank.service）
#
# 流程：拉代码 -> 装后端依赖 -> prisma 同步表结构 -> 装前端依赖+构建 -> 重启后端
# 说明：缓存目录也会清理，保证每次构建干净
# =============================================================================
set -euo pipefail

# 项目根目录（脚本所在位置）
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE=0

say()  { printf "\n\033[1;36m[%s/%s] %s\033[0m\n" "$STAGE" "5" "$1"; }
ok()   { printf "\033[1;32m   ok: %s\033[0m\n" "$1"; }
fail() { printf "\033[1;31m  ERR: %s\033[0m\n" "$1" >&2; exit 1; }

cd "$BASE_DIR"

# ---------- 1/5 拉取代码 ----------
STAGE=1; say "拉取最新代码 (git pull)"
if [ -d .git ]; then
  git fetch origin || fail "git fetch 失败（检查 Deploy Key 与网络）"
  # 优先 fast-forward 到当前追踪分支；无追踪分支则采用本地默认 master
  BRANCH="${1:-$(git symbolic-ref --short HEAD 2>/dev/null || echo master)}"
  git pull --ff-only origin "$BRANCH" || fail "git pull 失败（存在冲突，请人工处理）"
else
  fail "当前目录不是 git 仓库，请先执行 git init + remote add"
fi
ok "代码已更新到 $(git rev-parse --short HEAD)"

# ---------- 2/5 后端依赖 ----------
STAGE=2; say "安装后端依赖"
(cd server && npm install --no-audit --no-fund) || fail "server npm install 失败"
ok "后端依赖就绪"

# ---------- 3/5 数据库结构同步 ----------
STAGE=3; say "同步数据库结构 (prisma db push)"
(cd server && npx prisma db push) || fail "prisma db push 失败"
ok "表结构已同步"

# ---------- 4/5 前端依赖 + 构建 ----------
STAGE=4; say "安装前端依赖并构建"
(cd client && npm install --no-audit --no-fund && rm -rf node_modules/.vite dist && npm run build) || fail "前端构建失败"
ok "前端构建完成"

# ---------- 5/5 重启后端 ----------
STAGE=5; say "重启后端服务 (systemd)"
# 注意：勿用 systemctl list-units | grep -q 探测——
# 脚本开启 set -o pipefail 后，grep -q 匹配即退出会让 systemctl 收到 SIGPIPE，
# 整个管道被判为失败，导致误判“未找到服务”而跳过重启。
# 改用无管道的 systemctl is-active/is-enabled（返回码 0=存在），在 pipefail 下依然可靠。
if systemctl is-active --quiet gamerank 2>/dev/null || systemctl is-enabled --quiet gamerank 2>/dev/null; then
  sudo systemctl restart gamerank || fail "systemctl restart gamerank 失败"
  sudo systemctl status gamerank --no-pager | head -8 || true
else
  echo "   未找到 gamerank.service，跳过重启（请手动启动后端）"
fi

printf "\n\033[1;32m✅ 更新完成成功\033[0m\n"
echo "   - 代码:      $(git rev-parse --short HEAD)"
echo "   - 后端日志:  journalctl -u gamerank -f"