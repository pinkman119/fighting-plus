#!/usr/bin/env bash
# =====================================================================
# fighting-plus 服务端一键打包脚本
#
# 用法（在 Git Bash / WSL / Linux / macOS 的终端中执行）：
#   bash deploy/build.sh
#
# 产物输出到 deploy/output/：
#   fighting-plus-server_<版本>.tar.gz        服务端镜像（含 Web 静态资源 + 内置 RTMP 服务）
#   fighting-plus-server_<版本>.tar.gz.sha256 校验文件
#   deploy.sh                                 服务器端一键部署脚本
#
# 可选环境变量：
#   PLATFORM     目标平台，默认 linux/amd64（ARM 服务器改为 linux/arm64）
#   NODE_IMAGE   基础镜像，默认 node:20-bookworm-slim
#   NPM_REGISTRY npm 源，默认官方源，国内可设为 https://registry.npmmirror.com
#   VERSION      镜像版本号，默认读取 apps/server/package.json 的 version
#   COMPRESS     是否 gzip 压缩，默认 1；设为 0 则输出未压缩的 .tar
#   NO_CACHE     设为 1 时不使用 Docker 构建缓存
#
# 示例：
#   NPM_REGISTRY=https://registry.npmmirror.com bash deploy/build.sh
#   PLATFORM=linux/arm64 bash deploy/build.sh
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
STAGE_DIR="$SCRIPT_DIR/.build-context"

IMAGE_NAME="${IMAGE_NAME:-fighting-plus/server}"
PLATFORM="${PLATFORM:-linux/amd64}"
NODE_IMAGE="${NODE_IMAGE:-node:20-bookworm-slim}"
NPM_REGISTRY="${NPM_REGISTRY:-}"
COMPRESS="${COMPRESS:-1}"

log()  { printf '\033[32m[build]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[build]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[build]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  case "$(basename "$STAGE_DIR")" in
    .build-context) rm -rf "$STAGE_DIR" ;;
  esac
}
trap cleanup EXIT

# ---- 1. 前置检查 ----
command -v docker >/dev/null 2>&1 || die "未找到 docker 命令，请先安装 Docker"
docker info >/dev/null 2>&1 || die "Docker 守护进程未运行（Docker Desktop 请确认已启动且为 Linux 容器模式）"

VERSION="${VERSION:-$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/apps/server/package.json" | head -n 1)}"
[ -n "$VERSION" ] || die "无法从 apps/server/package.json 读取 version"

log "镜像: $IMAGE_NAME:$VERSION ($IMAGE_NAME:latest)"
log "目标平台: $PLATFORM"
log "基础镜像: $NODE_IMAGE"
[ -z "$NPM_REGISTRY" ] || log "npm 源: $NPM_REGISTRY"

# ---- 2. 组装干净的构建上下文（只拷贝需要的源码，不带 node_modules）----
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/apps/server" "$STAGE_DIR/apps/frontend" "$STAGE_DIR/packages"

# 服务端（NestJS）：源码、合流页、依赖清单
cp -R "$ROOT_DIR/apps/server/src" "$ROOT_DIR/apps/server/public" "$STAGE_DIR/apps/server/"
cp "$ROOT_DIR/apps/server/package.json" "$ROOT_DIR/apps/server/package-lock.json" "$ROOT_DIR/apps/server/tsconfig.json" "$STAGE_DIR/apps/server/"

# Web 端（Vue + Vite）：构建为静态资源，由服务端托管
cp -R "$ROOT_DIR/apps/frontend/src" "$STAGE_DIR/apps/frontend/"
cp "$ROOT_DIR/apps/frontend/index.html" \
   "$ROOT_DIR/apps/frontend/package.json" \
   "$ROOT_DIR/apps/frontend/package-lock.json" \
   "$ROOT_DIR/apps/frontend/tsconfig.json" \
   "$ROOT_DIR/apps/frontend/vite.config.ts" \
   "$STAGE_DIR/apps/frontend/"

# 共享协议类型（服务端 / Web 端都通过相对路径引用，必须保持 packages/shared 的位置）
cp -R "$ROOT_DIR/packages/shared" "$STAGE_DIR/packages/shared"

# ---- 3. 生成 Dockerfile ----
cat > "$STAGE_DIR/Dockerfile" <<'EOF'
ARG NODE_IMAGE=node:20-bookworm-slim

# ---- 阶段 1：构建 Web 端静态资源 ----
FROM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY
WORKDIR /app
COPY packages/shared ./packages/shared
COPY apps/frontend/package.json apps/frontend/package-lock.json ./apps/frontend/
RUN set -eu; [ -z "$NPM_REGISTRY" ] || npm config set registry "$NPM_REGISTRY"; cd apps/frontend && npm ci --no-audit --no-fund
COPY apps/frontend ./apps/frontend
RUN cd apps/frontend && npm run build

# ---- 阶段 2：安装服务端依赖 ----
# 服务端通过 tsx 直接运行 TS 源码（无编译产物），因此 tsx 等开发依赖在运行时也需要
FROM ${NODE_IMAGE} AS server-deps
ARG NPM_REGISTRY
WORKDIR /app
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/
RUN set -eu; [ -z "$NPM_REGISTRY" ] || npm config set registry "$NPM_REGISTRY"; cd apps/server && npm ci --no-audit --no-fund

# ---- 阶段 3：运行镜像 ----
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app/apps/server
COPY --chown=node:node --from=server-deps /app/apps/server/node_modules ./node_modules
COPY --chown=node:node apps/server/src ./src
COPY --chown=node:node apps/server/public ./public
# 服务端默认到 apps/frontend/dist 托管 Web 静态资源
COPY --chown=node:node --from=web /app/apps/frontend/dist /app/apps/frontend/dist
EXPOSE 3118 1935
USER node
CMD ["/app/apps/server/node_modules/.bin/tsx", "src/main.ts"]
EOF

# ---- 4. 构建镜像 ----
log "开始构建镜像..."
BUILD_ARGS=(
  --platform "$PLATFORM"
  -f "$STAGE_DIR/Dockerfile"
  --build-arg NODE_IMAGE="$NODE_IMAGE"
  --build-arg NPM_REGISTRY="$NPM_REGISTRY"
  -t "$IMAGE_NAME:$VERSION"
  -t "$IMAGE_NAME:latest"
)
if [ "${NO_CACHE:-0}" = "1" ]; then
  BUILD_ARGS+=(--no-cache)
fi
docker build "${BUILD_ARGS[@]}" "$STAGE_DIR"

# ---- 5. 导出镜像与部署文件到 deploy/output ----
mkdir -p "$OUTPUT_DIR"
# 清理旧版本的镜像包，避免服务器端 deploy.sh 选错版本
rm -f "$OUTPUT_DIR"/fighting-plus-server_*.tar "$OUTPUT_DIR"/fighting-plus-server_*.tar.gz "$OUTPUT_DIR"/fighting-plus-server_*.sha256

if [ "$COMPRESS" = "1" ]; then
  OUT_FILE="$OUTPUT_DIR/fighting-plus-server_${VERSION}.tar.gz"
  log "导出并压缩镜像到 $OUT_FILE ..."
  docker save "$IMAGE_NAME:$VERSION" "$IMAGE_NAME:latest" | gzip > "$OUT_FILE"
else
  OUT_FILE="$OUTPUT_DIR/fighting-plus-server_${VERSION}.tar"
  log "导出镜像到 $OUT_FILE ..."
  docker save -o "$OUT_FILE" "$IMAGE_NAME:$VERSION" "$IMAGE_NAME:latest"
fi

(cd "$OUTPUT_DIR" && sha256sum "$(basename "$OUT_FILE")" > "$(basename "$OUT_FILE").sha256")

# 部署脚本随镜像包一起输出，并统一为 LF 换行
sed 's/\r$//' "$SCRIPT_DIR/deploy.sh" > "$OUTPUT_DIR/deploy.sh"
chmod +x "$OUTPUT_DIR/deploy.sh" 2>/dev/null || true

log "打包完成，产物目录: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR" | sed 's/^/    /'
cat <<TIP

后续步骤：
  1. 把 output 目录下的全部文件上传到服务器，例如：
       scp -r deploy/output/* root@<服务器IP>:/opt/fighting-plus/
  2. 登录服务器执行一键部署：
       cd /opt/fighting-plus && bash deploy.sh
TIP
