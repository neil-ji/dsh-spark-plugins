#!/bin/sh
# dsh-spark-plugins 一键安装 / 更新
#
# 用法：
#   curl -fsSL https://neilji.github.io/dsh-spark-plugins/install.sh | sh
#   sh install.sh --profile web            # 指定 dsh profile（默认 web）
#   sh install.sh --ref v0.2.0             # 安装指定 tag/分支（默认 main）
#   sh install.sh --dry-run                # 只打印将执行的动作
#   sh install.sh --no-profile             # 只更新源码，不重链 profile
#
# 幂等：重复执行 = 更新到最新（或 --ref 指定的版本）。
set -e

REPO="https://github.com/neil-ji/dsh-spark-plugins.git"
DIR="$HOME/.dsh/spark-plugins"
PROFILE="web"
REF="main"
DRY=0
NO_PROFILE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-profile) NO_PROFILE=1; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

run() {
  if [ "$DRY" = "1" ]; then echo "  [dry-run] $ $*"; else "$@"; fi
}

echo "==> dsh-spark-plugins 安装器 (profile=$PROFILE ref=$REF dir=$DIR)"

command -v git  >/dev/null 2>&1 || { echo "✗ 需要 git（brew install git）";  exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ 需要 Node.js >= 18（https://nodejs.org）"; exit 1; }

if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> 未检测到 pnpm，尝试 corepack 启用"
  if command -v corepack >/dev/null 2>&1; then
    run corepack enable
  else
    run npm install -g pnpm
  fi
fi

if [ -d "$DIR/.git" ]; then
  echo "==> 更新已有克隆: $DIR"
  run git -C "$DIR" fetch --depth 1 origin "$REF"
  run git -C "$DIR" checkout -q FETCH_HEAD
else
  echo "==> 克隆仓库到 $DIR"
  run git clone --depth 1 -b "$REF" "$REPO" "$DIR"
fi

echo "==> 安装依赖（首次较慢）"
run sh -c "cd '$DIR' && pnpm install --config.confirmModulesPurge=false"

echo "==> 构建全部包"
run sh -c "cd '$DIR' && pnpm -r build"

if [ "$NO_PROFILE" = "1" ]; then
  echo "==> 跳过 profile 重链（--no-profile）"
else
  echo "==> 链接到 dsh profile: $PROFILE"
  run sh -c "cd '$DIR' && node scripts/install-profile.mjs '$PROFILE'"
fi

echo ""
echo "✅ 完成。重启 dsh web 生效："
echo "   dsh web --profile $PROFILE"
echo ""
echo "   卸载：dsh plugin --profile $PROFILE remove <插件名>; rm -rf $DIR"
