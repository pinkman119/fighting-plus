# Design: shared-tactical-board-mvp

## Context

fighting-plus 是全新项目（空仓库），面向三角洲行动等撤离射击游戏的三人小队（房间上限 6 人）。已确认的技术选型：客户端 Electron + Vue 3（首版仅 Windows），服务端 Node.js + NestJS，公网部署由开发者自行运营。核心场景是低频标注（QPS 极低）、小房间（≤6 人）实时同步，安全红线是**绝不注入游戏进程**（三角洲行动带 ACE 反作弊）。

## Goals / Non-Goals

**Goals:**
- 房间内 ≤6 人实时共享标注，端到端同步延迟 <500ms
- Overlay 为纯透明置顶窗口，零注入、零封号风险
- 断线重连后画布状态与服务端严格一致
- 账号体系下保存历史局，可回看标注快照
- 初期支撑 ~200 并发房间

**Non-Goals:**
- 注入式 Overlay / 读取游戏内存 / 自动定位敌人
- 语音、文字聊天
- 内置官方地图
- macOS / Linux 支持
- 标注冲突的 CRDT 协同算法
- 大规模水平扩展（仅预留，不实现）

## Decisions

**D1. Monorepo 结构：`client/` + `server/` 两个独立子项目**
不引入 pnpm workspace 等工具复杂度——两端技术栈独立（Vite/Vue vs NestJS），各自安装依赖即可。

**D2. 实时通道：Socket.IO（`@nestjs/platform-socket.io`）**
房间语义与 Socket.IO room 天然映射；内置断线重连、心跳、房间广播。备选原生 WebSocket 需自建重连协议与房间路由，MVP 无收益，弃。

**D3. 同步模型：服务端单一事实源 + 全量快照 + 增量操作广播**
加入/重连时服务端下发房间快照（当前地图 + 存活标注列表 + 成员列表），此后仅广播操作事件（`annotation:add/update/remove`、`map:change`、`board:clear`）。事件按服务端接收顺序编号，保证多端一致。不采用 CRDT：≤6 人、低频标注，"服务端顺序 + 最后写入胜"足够，避免引入 Yjs/Automerge 复杂度。

**D4. 标注数据模型**
`Annotation { id, roomId, type: pin|arrow|zone|text, payload(几何坐标/文字), authorId, authorColor, createdAt, updatedAt, removedAt? }`。成员颜色由服务端入房时分配（6 色调色板去重分配），全房间一致。标注只能由创建者编辑；删除权限：任何成员可删（快节奏对局不能等权限协商）。

**D5. 地图图片：客户端上传 → 服务端本地磁盘静态目录（预留 S3 适配层）**
限制 ≤10MB，类型白名单 jpg/png/webp；房间内私有，广播为静态 URL。MVP 不接对象存储，接口抽象成 `StorageService` 便于后续替换。

**D6. Overlay：Electron 透明 BrowserWindow + `setAlwaysOnTop` + `globalShortcut` + `setIgnoreMouseEvents`**
不注入、不读取游戏状态。呼出热键默认 `Alt+Q`（可配置）。Overlay 窗口复用主窗口的画布组件，锁定为只读；`setIgnoreMouseEvents(true, {forward: true})` 实现点击穿透切换。要求游戏以"无边框窗口"模式运行，首启引导与 Overlay 设置页均明示。

**D7. 认证：JWT access（2h）+ refresh token（7d，DB 存储、支持吊销）**
HTTP 请求走 Bearer；Socket 握手 query 携带 JWT，NestJS 网关校验后绑定 `userId`。密码 bcrypt 哈希。

**D8. 画布：Konva（vue-konva）**
Vue 3 集成成熟、拖拽/缩放/命中检测性能好。备选 fabric.js（偏自由绘图编辑器场景，序列化体系绑定较重），弃。

**D9. 存储：PostgreSQL + Prisma ORM**
表：`users`、`refresh_tokens`、`rooms`、`room_members`、`annotations`、`matches`（归档含快照 JSONB）。活跃房间不引入 Redis——直接查库 + Socket.IO 内存态广播，规模内够用；水平扩展时再加 `@socket.io/redis-adapter`（代码注释预留）。

**D10. 标记时效：纯客户端渲染**
透明度曲线由 `createdAt` 本地计算（0–30s 全不透明 → 5min 衰减至 0.3，永不自动删除），避免服务端定时器；"X秒前"标签本地定时刷新。手动移除才产生服务端事件。

**D11. 房间生命周期：`active → archived`**
房主离线不销毁；全体离线 30 分钟后服务端自动归档（可配置）。归档时将当前标注状态写入 `matches` 快照。

**D12. 一键清空：任何成员可发起 + 本地二次确认弹窗**
清空是破坏性操作但不做全房投票——对局节奏优先，误清可撤销（撤销栈保留被清标注）。

## Risks / Trade-offs

- [Overlay 在游戏全屏独占模式下不可见] → 引导用户使用无边框窗口模式；首启检测显示器/设置并提示；文档明示限制
- [两人同时编辑同一标注产生竞态] → 标注仅创建者可改；并发概率极低，最后写入胜；服务端顺序编号兜底
- [地图截图可能涉版权] → 图片仅房间内私有共享，不公开、不检索；大小/类型白名单
- [自运营单点故障] → MVP 单实例 + Postgres 每日备份；预留 Socket.IO redis adapter 与无状态网关扩展路径
- [公网传输安全] → 强制 HTTPS/WSS（Let's Encrypt）；JWT 过期短化；上传文件类型嗅探校验
- [清空误操作] → 撤销栈保留被清标注，`Ctrl+Z` 可整批恢复

## Migration Plan

全新项目，无迁移。部署顺序：先 `server/`（含数据库迁移脚本），再 `client/` 打包 Windows 安装包分发。回滚 = 客户端回退旧版本安装包，服务端接口版本化（`/api/v1`）。

## Open Questions

- Refresh token 轮换策略（滑动续期 vs 固定过期）：实现期决定，不影响规格
- 房间邀请码格式（4 位 vs 6 位）与防碰撞策略：实现期决定
