# 屏幕共享原型（screen-share prototype）

三人房间互相观看屏幕的快速原型：**Electron 客户端 + NestJS 信令服务 + WebRTC Mesh（P2P）**。
媒体流不经过服务器（点对点），服务端只转发 SDP/ICE 信令。

## 结构

```
prototype/screen-share/
├── server/   # NestJS + Socket.IO 信令服务（端口 3100）
└── client/   # Electron 桌面客户端
```

## 运行

### 1. 启动信令服务

```bash
cd server
npm install
npm run dev        # 监听 http://localhost:3100
```

### 2. 启动客户端（可开多个实例模拟 A/B/C 三个用户）

```bash
cd client
npm install
npm start          # 第一个窗口 = 用户 A
npm start          # 再开一个 = 用户 B
npm start          # 再开一个 = 用户 C
```

### 3. 操作

1. 用户 A：输入名字 `A` → 点「创建房间」（自动生成 4 位房间码）
2. 用户 B、C：分别输入名字 `B`、`C`，填入相同房间码 → 「加入房间」
3. 三人各自点击「开始共享屏幕」→ 每个人的窗口**主区域**显示队友的屏幕，**底部固定条**是本机屏幕预览

### 跨机器（局域网）测试

- 登录页「服务器地址」填信令服务所在机器的局域网 IP，例如 `192.168.1.100:3100`（各客户端地址会被记住）
- 服务端机器需放行防火墙 3100 端口（入站 TCP）
- 服务器地址连接失败时，登录页会显示明确错误提示

## 说明

- `getDisplayMedia` 由 Electron 主进程的 `setDisplayMediaRequestHandler` 处理，
  自动采集**主显示器**，不弹系统选择框（原型简化）。
- 同一局域网内 P2P 直连；跨公网依赖 STUN（已配置 google STUN，未配置 TURN）。
- 双方同时共享的协商冲突用「完美协商（perfect negotiation）」规则解决。
- 同一台机器测试时，共享的是同一个桌面（镜子效应），属正常现象。
