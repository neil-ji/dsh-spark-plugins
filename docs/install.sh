#!/bin/sh
# dsh-spark-plugins 一键安装 / 更新（Linux / macOS / WSL）
#
# 默认路径（推荐）：从 GitHub Release 下载 CI 预构建的 tarball —— 不 clone、不构建、不需要 pnpm。
#   1. 取 manifest.json（含版本、dsh 兼容区间、每个包的 sha256）
#   2. 取 release-install.mjs 并按 manifest 校验其 sha256
#   3. 由安装器下载各包 tarball、逐个校验 sha256，再写进目标 dsh profile
#
# 用法：
#   curl -fsSL https://neil-ji.github.io/dsh-spark-plugins/install.sh | sh
#   sh install.sh --profile web            # 指定 dsh profile（默认 web）
#   sh install.sh --version v0.2.0         # 装指定 tag（默认 latest）
#   sh install.sh --home /tmp/dev-home     # 目标 DSH_HOME（默认 $DSH_HOME，再默认 ~/.dsh）
#   sh install.sh --only dsh-spark,dsh-connector-npm   # 只装部分插件
#   sh install.sh --base-url <url|dir>     # 换源（镜像 / 本地发布目录）
#   sh install.sh --dry-run                # 只打印将执行的动作
#   sh install.sh --uninstall              # 卸载（只摘本插件，保留 profile 里其它插件）
#   sh install.sh --uninstall --dry-run    # 卸载预演：只列出将删什么
#   sh install.sh --uninstall --keep-cache # 卸载但保留 $DSH_HOME/spark-plugins 缓存
#   sh install.sh --from-source            # 旧路径：clone + pnpm install + build + install-profile
#   sh install.sh --ref v0.2.0 --dir ~/src # （配合 --from-source）源码版本与目录
#
# 前置：Node.js >= 18；**安装/卸载都需要 pnpm**（把 tarball 解析进 profile 的 node_modules）。
#       没有 pnpm 时可用 `corepack enable`（Node 16.9+ 自带）或 `npm install -g pnpm`。
#
# 幂等：重复执行 = 更新到最新（或 --version 指定的版本）。
set -e

REPO_URL="https://github.com/neil-ji/dsh-spark-plugins"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE="web"
VERSION=""
BASE_URL=""
ONLY=""
DIR=""
REF="main"
DRY=0
FROM_SOURCE=0
UNINSTALL=0
KEEP_CACHE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --from-source) FROM_SOURCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --keep-cache) KEEP_CACHE=1; shift ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

run() {
  if [ "$DRY" = "1" ]; then echo "  [dry-run] $ $*"; else "$@"; fi
}

# 取一个资产：支持 http(s) / file:// / 本地目录（后者便于离线镜像与自测）
fetch() {
  case "$1" in
    http://*|https://*) run curl -fsSL "$1" -o "$2" ;;
    file://*) run cp "${1#file://}" "$2" ;;
    *) run cp "$1" "$2" ;;
  esac
}

need_node() {
  command -v node >/dev/null 2>&1 || { echo "✗ 需要 Node.js >= 18（https://nodejs.org）"; exit 1; }
  major=$(node -p "process.versions.node.split('.')[0]")
  [ "$major" -ge 18 ] || { echo "✗ Node.js 版本过低（$major），需要 >= 18"; exit 1; }
}

# ── 默认路径：Release 资产 ──────────────────────────────────────────────────
if [ "$FROM_SOURCE" = "0" ]; then
  echo "==> dsh-spark-plugins 安装器（release 资产，profile=$PROFILE version=${VERSION:-latest} home=$HOME_DIR）"
  need_node

  if [ -z "$BASE_URL" ]; then
    if [ -n "$VERSION" ]; then BASE_URL="$REPO_URL/releases/download/$VERSION"
    else BASE_URL="$REPO_URL/releases/latest/download"; fi
  fi
  case "$BASE_URL" in
    http://*|https://*) command -v curl >/dev/null 2>&1 || { echo "✗ 需要 curl"; exit 1; } ;;
  esac

  TMP="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/dsh-spark-install.$$")"
  mkdir -p "$TMP"
  trap 'rm -rf "$TMP"' EXIT

  # ── 卸载：与安装对称，只下载卸载器（不碰 tarball） ──
  if [ "$UNINSTALL" = "1" ]; then
    echo "==> 下载卸载器：$BASE_URL/release-uninstall.mjs"
    fetch "$BASE_URL/release-uninstall.mjs" "$TMP/release-uninstall.mjs"
    set -- --profile "$PROFILE" --home "$HOME_DIR"
    if [ "$DRY" = "1" ]; then set -- "$@" --dry-run; fi
    if [ "$KEEP_CACHE" = "1" ]; then set -- "$@" --keep-cache; fi
    echo "==> 卸载"
    run node "$TMP/release-uninstall.mjs" "$@"
    exit 0
  fi

  echo "==> 下载清单：$BASE_URL/manifest.json"
  fetch "$BASE_URL/manifest.json" "$TMP/manifest.json"
  echo "==> 下载安装器：$BASE_URL/release-install.mjs"
  fetch "$BASE_URL/release-install.mjs" "$TMP/release-install.mjs"

  if [ "$DRY" = "0" ]; then
    echo "==> 校验安装器 sha256"
    node -e '
      const { createHash } = require("node:crypto");
      const { readFileSync } = require("node:fs");
      const [manifestPath, filePath] = process.argv.slice(1);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const want = manifest.installer?.sha256;
      if (!want) { console.error("✗ 清单里没有 installer.sha256"); process.exit(1); }
      const got = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      if (got !== want) { console.error(`✗ 安装器校验失败：期望 ${want}，实际 ${got}`); process.exit(1); }
      console.log(`    ✓ sha256 ${got.slice(0, 12)}…（${manifest.tag}）`);
    ' "$TMP/manifest.json" "$TMP/release-install.mjs"
  fi

  set -- --base-url "$BASE_URL" --profile "$PROFILE" --home "$HOME_DIR"
  if [ -n "$ONLY" ]; then set -- "$@" --only "$ONLY"; fi
  if [ "$DRY" = "1" ]; then set -- "$@" --dry-run; fi

  echo "==> 安装"
  run node "$TMP/release-install.mjs" "$@"
  exit 0
fi

# ── --from-source：clone + 构建（开发 / 离线 / 自建镜像） ─────────────────────
[ -n "$DIR" ] || DIR="$HOME_DIR/spark-plugins"

echo "==> dsh-spark-plugins 安装器（源码构建，profile=$PROFILE ref=$REF dir=$DIR home=$HOME_DIR）"
need_node
command -v git >/dev/null 2>&1 || { echo "✗ 需要 git"; exit 1; }

if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> 未检测到 pnpm，尝试 corepack 启用"
  if command -v corepack >/dev/null 2>&1; then run corepack enable
  else run npm install -g pnpm; fi
fi

if [ -d "$DIR/.git" ]; then
  echo "==> 更新已有克隆: $DIR"
  run git -C "$DIR" fetch --depth 1 origin "$REF"
  run git -C "$DIR" checkout -q FETCH_HEAD
else
  echo "==> 克隆仓库到 $DIR"
  run git clone --depth 1 -b "$REF" "$REPO_URL.git" "$DIR"
fi

echo "==> 安装依赖（首次较慢）"
run sh -c "cd '$DIR' && pnpm install --config.confirmModulesPurge=false"

echo "==> 构建全部包"
run sh -c "cd '$DIR' && pnpm -r build"

echo "==> 安装到 dsh profile: $PROFILE (home=$HOME_DIR)"
run sh -c "cd '$DIR' && node scripts/install-profile.mjs '$PROFILE' --home '$HOME_DIR' --no-build --register-bundles"

echo ""
echo "✅ 完成。重启 dsh web 生效："
echo "   dsh --profile $PROFILE"
echo ""
echo "   卸载：sh install.sh --uninstall --profile $PROFILE"
