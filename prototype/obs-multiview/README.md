# OBS 多路合流原型（obs-multiview prototype）

三个人（A/B/C）各用一台 OBS 推流到服务器，服务器把三路画面合成一个页面，
再把该页面作为「浏览器源」送进导播 OBS，形成可再推流到最终平台的合流画面。

**架构**：

```
OBS-A ─┐
OBS-B ─┼─ RTMP 推流 → SRS 流媒体服务器(Docker) ─ HTTP-FLV/HLS ┐
OBS-C ─┘                                                      ├→ NestJS 代理 → /composite 合流页
                                                              ┘         ↑
导播 OBS ←── 浏览器源(合流页) ←──────────────────────────────────────┘
导播 OBS ←── obs-websocket 自动创建浏览器源（POST /api/obs/multiview）
```

## 结构

```
prototype/obs-multiview/
├── docker-compose.yml   # SRS 流媒体服务器（RTMP 收流）
├── srs.conf             # SRS 配置（HTTP-FLV / HLS 输出）
└── server/              # NestJS 后端（端口 3200）
    └── public/composite.html  # 三路合流展示页
```

## 运行

### 1. 启动 SRS（需要 Docker）

```bash
cd prototype/obs-multiview
docker compose up -d
# 检查：curl http://127.0.0.1:1985/api/v1/streams 应返回 {"code":0,...}
```

### 2. 启动 NestJS 后端

```bash
cd server
npm install
npm run dev        # 监听 http://0.0.0.0:3200
```

### 3. OBS 设置（A/B/C 三个用户）

OBS → 设置 → 推流：

| 用户 | 服务器 | 推流码 |
| ---- | ------ | ------ |
| A | `rtmp://<服务器IP>:1935/live` | `A` |
| B | `rtmp://<服务器IP>:1935/live` | `B` |
| C | `rtmp://<服务器IP>:1935/live` | `C` |

同机测试 `<服务器IP>` 可用 `localhost`；跨机器用局域网 IP（`ipconfig` 查看）。
点「开始推流」即可，合流页对应格子会自动开始播放。

### 4. 导播 OBS（合流输出）

两种方式任选：

**手动**：导播 OBS → 添加「浏览器」源 → URL 填 `http://<服务器IP>:3200/composite`，宽 1920 高 1080。

**自动（服务端与 OBS 交互）**：导播 OBS 开启「工具 → WebSocket 服务器设置」
（默认端口 4455，如有密码设环境变量 `OBS_WS_PASSWORD`），然后：

```bash
curl -X POST http://localhost:3200/api/obs/multiview -H "Content-Type: application/json" -d "{}"
# 可选参数：{ "recreate": true, "sceneName": "场景1", "width": 1920, "height": 1080, "url": "..." }
```

服务器会通过 obs-websocket 在当前场景自动创建名为「多人合流-MultiView」的浏览器源。

## 接口一览

| 接口 | 说明 |
| ---- | ---- |
| `GET /composite` | 三路合流页面（给 OBS 浏览器源用） |
| `GET /api/streams` | A/B/C 在线状态 + 推流/拉流地址 |
| `GET /api/obs/status` | 导播 OBS WebSocket 连接状态与场景列表 |
| `POST /api/obs/multiview` | 自动在导播 OBS 创建合流浏览器源 |
| `GET /live/:file` | 媒体代理（HTTP-FLV / HLS，转发到 SRS） |

## 环境变量（均有默认值）

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `PORT` | `3200` | NestJS 监听端口 |
| `SRS_API_URL` | `http://127.0.0.1:1985` | SRS HTTP API |
| `SRS_HTTP_URL` | `http://127.0.0.1:8080` | SRS HTTP 流服务 |
| `OBS_WS_URL` | `ws://127.0.0.1:4455` | 导播 OBS 的 obs-websocket 地址 |
| `OBS_WS_PASSWORD` | 空 | obs-websocket 密码 |

## 说明

- 播放协议：合流页优先 HTTP-FLV（`mpegts.js`，延迟约 1~3 秒），失败自动回退 HLS。
- 延迟属正常现象：推流端编码 + FLV 缓冲，可通过调低 OBS 推流参数（x264 `zerolatency`）改善。
- 跨机器测试需放行防火墙端口：`1935`（RTMP 推流）、`3200`（合流页/API）。
- 声音：合流页默认静音（`muted`）；导播 OBS 的浏览器源勾选「经由浏览器控制音频」后可听到。
