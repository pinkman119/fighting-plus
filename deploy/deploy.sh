#!/usr/bin/env bash
# =====================================================================
# fighting-plus 服务端一键部署脚本
#
# 由 deploy/build.sh 打包时自动复制到 output 目录，与镜像包一起上传到服务器。
#
# 用法（在镜像包所在目录执行）：
#   bash deploy.sh              # 一键部署：加载镜像包 + 启动服务（最常用）
#   bash deploy.sh up           # 同上；目录下没有镜像包时直接用已有镜像启动
#   bash deploy.sh load         # 仅加载镜像包（不启动）
#   bash deploy.sh status       # 查看运行状态
#   bash deploy.sh logs         # 跟踪查看日志（Ctrl+C 退出）
#   bash deploy.sh restart      # 重启服务
#   bash deploy.sh down         # 停止并移除容器
#
# 首次运行会在当前目录生成：
#   .env                配置文件（端口、OBS WebSocket 等），可按需修改后 restart
#   docker-compose.yml  编排文件（一般无需修改；删除后可重新生成）
#
# 升级：上传新的镜像包覆盖旧包（或删除旧包），再次执行 bash deploy.sh
# =====================================================================
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fighting-plus}"

IMAGE_NAME="${IMAGE_NAME:-fighting-plus/server}"
CONTAINER="fighting-plus-server"
ENV_FILE=".env"
COMPOSE_FILE="docker-compose.yml"

log()  { printf '\033[32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 基础工具函数 ----

COMPOSE_CMD=""
detect_compose() {
  if [ -n "$COMPOSE_CMD" ]; then return; fi
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    die "未找到 Docker Compose，请安装 Docker Compose v2（docker compose）或 docker-compose"
  fi
}

compose() {
  detect_compose
  $COMPOSE_CMD "$@"
}

# 读取 .env 中某个键的值（取最后一次出现）
get_env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s|^$1=\(.*\)|\1|p" "$ENV_FILE" | tail -n 1
}

# 写入 / 更新 .env 中的某个键
set_env_value() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# 首次运行时生成配置文件与编排文件（已存在则不覆盖）
ensure_files() {
  if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<'ENV'
# fighting-plus 部署配置（首次运行 deploy.sh 时生成，修改后执行 bash deploy.sh restart 生效）

# 镜像版本（deploy.sh 每次加载镜像包时会自动更新，一般无需手动修改）
IMAGE_TAG=

# 宿主机对外 HTTP 端口（Web 页面 / API / WebSocket 共用）
HTTP_PORT=3118

# ---------- 以下为传入容器的服务端环境变量，按需取消注释 ----------

# 导播 OBS 的 obs-websocket 地址。OBS 与 Docker 在同一台机器时，
# 容器内无法通过 127.0.0.1 访问宿主机，请使用 host.docker.internal
#OBS_WS_URL=ws://host.docker.internal:4455
#OBS_WS_PASSWORD=

# 对外推流地址，默认按请求 Host 推导为 rtmp://<访问IP>:1935/live。
# 通过域名 / 反向代理访问且推导结果不对时，显式指定（端口必须是 1935）
#RTMP_PUSH_SERVER=rtmp://1.2.3.4:1935/live

# 在线流状态轮询间隔（毫秒）
#SRS_POLL_INTERVAL_MS=2000
ENV
    log "已生成配置文件 $ENV_FILE"
  fi

  if [ ! -f "$COMPOSE_FILE" ]; then
    cat > "$COMPOSE_FILE" <<'YAML'
services:
  server:
    image: fighting-plus/server:${IMAGE_TAG:?set IMAGE_TAG in .env}
    container_name: fighting-plus-server
    restart: unless-stopped
    env_file:
      - .env
    ports:
      # Web 页面 / API / WebSocket
      - "${HTTP_PORT:-3118}:3118"
      # RTMP 推流（OBS 推流地址 rtmp://<服务器IP>:1935/live）
      # 服务端按请求 Host 推导推流地址时固定使用 1935，请勿修改宿主机端口
      - "1935:1935"
    # 让容器可以通过 host.docker.internal 访问宿主机（例如同机的导播 OBS）
    extra_hosts:
      - "host.docker.internal:host-gateway"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3118/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      driver: json-file
      options:
        max-size: "20m"
        max-file: "5"
YAML
    log "已生成编排文件 $COMPOSE_FILE"
  fi
}

# 查找最新的镜像包（多个版本并存时取版本号最大的一个）
find_tarball() {
  ls -1 "$DEPLOY_DIR"/fighting-plus-server_*.tar.gz "$DEPLOY_DIR"/fighting-plus-server_*.tar 2>/dev/null | sort -V | tail -n 1 || true
}

# 从文件名 fighting-plus-server_<版本>.tar[.gz] 中取出版本号
tarball_version() {
  local name
  name="$(basename "$1")"
  name="${name#fighting-plus-server_}"
  name="${name%.tar.gz}"
  name="${name%.tar}"
  printf '%s' "$name"
}

# 镜像架构与服务器 CPU 架构不一致时给出提示（会导致容器无法运行）
warn_arch_mismatch() {
  local image_arch host_arch
  image_arch="$(docker image inspect --format '{{.Architecture}}' "$IMAGE_NAME:$1" 2>/dev/null || true)"
  case "$(uname -m)" in
    x86_64) host_arch="amd64" ;;
    aarch64 | arm64) host_arch="arm64" ;;
    *) host_arch="" ;;
  esac
  if [ -n "$image_arch" ] && [ -n "$host_arch" ] && [ "$image_arch" != "$host_arch" ]; then
    warn "镜像架构为 $image_arch，服务器为 $host_arch，容器可能无法运行；请用 PLATFORM=linux/$host_arch 重新打包"
  fi
}

# ---- 子命令 ----

cmd_load() {
  local tarball version
  tarball="$(find_tarball)"
  [ -n "$tarball" ] || die "当前目录未找到镜像包 fighting-plus-server_*.tar.gz"
  version="$(tarball_version "$tarball")"

  log "加载镜像包: $(basename "$tarball")"
  docker load -i "$tarball"

  # 让编排文件使用刚加载的版本
  set_env_value IMAGE_TAG "$version"
  warn_arch_mismatch "$version"
  log "镜像已就绪: $IMAGE_NAME:$version"
}

wait_healthy() {
  local i status
  log "等待服务就绪..."
  for i in $(seq 1 30); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "missing")"
    if [ "$status" = "healthy" ]; then
      log "服务已就绪（$((i * 2 - 2))s）"
      return 0
    fi
    sleep 2
  done
  warn "服务在 60 秒内未通过健康检查，最近日志："
  compose logs --tail=50 server || true
  die "服务启动异常，请排查后执行 bash deploy.sh restart"
}

print_access() {
  local http_port host_ip
  http_port="$(get_env_value HTTP_PORT)"
  http_port="${http_port:-3118}"
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$host_ip" ] || host_ip="<服务器IP>"

  cat <<INFO

================ fighting-plus 已启动 ================
  Web 页面 / API : http://${host_ip}:${http_port}
  合流页         : http://${host_ip}:${http_port}/composite
  OBS 推流地址   : rtmp://${host_ip}:1935/live
  当前镜像版本   : $(get_env_value IMAGE_TAG)

  请确认服务器防火墙 / 安全组已放行: ${http_port}（HTTP）、1935（TCP，RTMP 推流）
  常用命令（在本目录执行）:
    bash deploy.sh status    查看状态
    bash deploy.sh logs      查看日志
    bash deploy.sh restart   重启（修改 .env 后使用）
    bash deploy.sh down      停止服务
======================================================
INFO
}

cmd_up() {
  ensure_files

  # 目录下有镜像包时先加载；没有则复用服务器上已有的镜像
  if [ "${SKIP_LOAD:-0}" != "1" ] && [ -n "$(find_tarball)" ]; then
    cmd_load
  fi

  local tag
  tag="$(get_env_value IMAGE_TAG)"
  if [ -z "$tag" ]; then
    tag="latest"
    set_env_value IMAGE_TAG "$tag"
  fi
  if ! docker image inspect "$IMAGE_NAME:$tag" >/dev/null 2>&1; then
    die "镜像 $IMAGE_NAME:$tag 不存在，请确认已上传镜像包后重试"
  fi

  log "启动服务: $IMAGE_NAME:$tag"
  compose up -d --remove-orphans
  wait_healthy
  print_access
}

cmd_status() {
  local tag
  tag="$(get_env_value IMAGE_TAG)"
  tag="${tag:-latest}"
  log "镜像: $IMAGE_NAME:$tag"
  docker ps -a --filter "name=^${CONTAINER}\$" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
}

usage() {
  cat <<'USAGE'
用法: bash deploy.sh [命令]

命令:
  up (默认)   一键部署：加载镜像包 + 启动服务；目录下没有镜像包时用已有镜像启动
  load        仅加载镜像包（不启动）
  status      查看运行状态
  logs        跟踪查看日志（Ctrl+C 退出）
  restart     重启服务（修改 .env 后使用）
  down        停止并移除容器
  help        显示本帮助
USAGE
}

# ---- 入口 ----
command -v docker >/dev/null 2>&1 || die "未找到 docker 命令，请先安装 Docker"

case "${1:-up}" in
  up | start)
    cmd_up
    ;;
  load)
    ensure_files
    cmd_load
    ;;
  status | ps)
    ensure_files
    compose ps
    cmd_status
    ;;
  logs | log)
    ensure_files
    compose logs -f --tail=200 server
    ;;
  restart)
    ensure_files
    compose up -d --force-recreate --remove-orphans
    wait_healthy
    print_access
    ;;
  down)
    ensure_files
    compose down
    log "服务已停止并移除（配置文件 .env 保留）"
    ;;
  help | -h | --help)
    usage
    ;;
  *)
    usage
    die "未知命令: $1"
    ;;
esac
