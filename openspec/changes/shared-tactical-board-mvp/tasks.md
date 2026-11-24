# Tasks: shared-tactical-board-mvp

## 1. 项目脚手架

- [ ] 1.1 初始化 `server/`：NestJS 项目（TypeScript strict），配置 ESLint/Prettier，确立 `/api/v1` 版本化路由前缀
- [ ] 1.2 初始化 `client/`：Electron + Vue 3 + Vite 工程，配置主进程/渲染进程结构与环境变量
- [ ] 1.3 server 接入 PostgreSQL + Prisma，定义 `users`、`refresh_tokens`、`rooms`、`room_members`、`annotations`、`matches` 表结构并生成迁移
- [ ] 1.4 建立共享类型包或共享类型文件（Annotation、RoomEvent 等接口定义，client/server 复用）

## 2. 账号系统（user-auth）

- [ ] 2.1 实现 `AuthModule`：注册（邮箱唯一校验、bcrypt 哈希）、登录
- [ ] 2.2 实现 JWT 策略：access token（2h）签发/校验、refresh token（7d）存储与刷新接口
- [ ] 2.3 实现用户资料接口：查询/修改昵称（非空 ≤16 字符）、选择预置头像
- [ ] 2.4 client 实现登录/注册页与账号资料页，token 本地安全存储与自动刷新

## 3. 房间系统（room-management）

- [ ] 3.1 实现房间 REST API：创建房间（生成唯一邀请码）、凭码加入（6 人上限校验）、房间详情
- [ ] 3.2 实现 Socket.IO 网关：JWT 握手校验、加入房间、成员在线状态维护（10s 离线判定）、成员颜色分配（6 色调色板去重）
- [ ] 3.3 实现房主移交逻辑与广播
- [ ] 3.4 实现房间归档：房主手动归档 + 全员离线 30 分钟自动归档（定时任务），归档时生成对局快照
- [ ] 3.5 client 实现大厅（创建/加入房间）与房间页（成员列表、在线状态、房主操作、邀请码展示/复制）

## 4. 共享战术板（tactical-board）

- [ ] 4.1 实现地图上传：client 文件选择与预校验（类型/大小），server `StorageService`（本地磁盘静态目录，≤10MB，类型白名单）+ 上传接口 + 换图广播
- [ ] 4.2 实现画布基础：Konva 画布组件、滚轮缩放（10%–400%）与拖拽平移（仅本地视图）
- [ ] 4.3 实现标注工具-点标记：点击创建敌人位置图标，文字备注（数量），创建者颜色与时间戳
- [ ] 4.4 实现标注工具-箭头：拖拽绘制 A→B 箭头
- [ ] 4.5 实现标注工具-区域：拖拽圈选圆形/矩形半透明区域
- [ ] 4.6 实现编辑控制：本地撤销/重做栈、橡皮擦删除、一键清空（二次确认弹窗 + 可撤销恢复）
- [ ] 4.7 实现实时同步协议：服务端事件编号排序广播（annotation:add/update/remove、map:change、board:clear），端到端 <500ms
- [ ] 4.8 实现断线重连：重连后拉取全量快照（地图+存活标注+成员）重建画布，补齐断线期间事件
- [ ] 4.9 实现标记时效渲染：客户端按 `createdAt` 计算透明度曲线（30s 全不透明→5min 衰减至 30%）、"X秒前"标签定时刷新
- [ ] 4.10 服务端持久化标注增删改到 `annotations` 表（软删除 `removedAt`）

## 5. Overlay 模式（overlay-mode）

- [ ] 5.1 实现 Overlay 透明置顶窗口：BrowserWindow 透明 + `setAlwaysOnTop` + 任务栏隐藏
- [ ] 5.2 实现全局热键（默认 Alt+Q，可配置）呼出/隐藏，`globalShortcut` 注册与注销（退出时清理）
- [ ] 5.3 实现点击穿透切换：`setIgnoreMouseEvents(true, {forward:true})` 切换，穿透态仅展示、非穿透态支持删除单个标注
- [ ] 5.4 Overlay 复用主画布组件并锁定查看模式（隐藏编辑工具栏）
- [ ] 5.5 实现首次使用引导：提示游戏需以无边框窗口模式运行

## 6. 历史局（match-history）

- [ ] 6.1 实现历史局列表接口（按结束时间倒序，仅本人参与的）与客户端历史对局页
- [ ] 6.2 实现历史局回看页：加载快照（地图+标注），只读渲染，支持缩放平移

## 7. 集成验证与打包

- [ ] 7.1 三端联调：模拟 3 客户端房间，验证同步延迟、断线重连一致性、6 人上限、清空撤销
- [ ] 7.2 服务端安全加固：HTTPS/WSS 配置、上传文件类型嗅探、限流
- [ ] 7.3 Electron 打包 Windows 安装包（含自动更新预留），编写部署脚本（server 单实例 + Postgres 备份）
- [ ] 7.4 对照 specs 逐条验收：运行 `openspec validate shared-tactical-board-mvp --strict` 并人工核对场景
