import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

interface PeerInfo {
  socketId: string
  roomId: string
  name: string
}

interface JoinPayload {
  roomId: string
  peerId: string
  name: string
}

interface JoinAck {
  ok: boolean
  peers?: { peerId: string; name: string }[]
  error?: string
}

/**
 * WebRTC 信令网关（原型）：
 * - join：加入房间，返回已在房间内的其他成员（ack），并广播 peer-joined
 * - signal：SDP/ICE 中继，按 peerId 定向转发
 * - leave / disconnect：广播 peer-left
 */
@WebSocketGateway({
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout: 5000
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server

  /** peerId -> 成员信息 */
  private peers = new Map<string, PeerInfo>()
  /** socketId -> peerId（断线反查） */
  private socketToPeer = new Map<string, string>()

  handleConnection(_client: Socket): void {
    // 身份随 join 事件携带，此处无需处理
  }

  @SubscribeMessage('join')
  join(client: Socket, payload: JoinPayload): JoinAck {
    const { roomId, peerId, name } = payload ?? ({} as JoinPayload)
    if (!roomId || !peerId || !name) {
      return { ok: false, error: 'roomId / peerId / name 必填' }
    }

    const safeName = String(name).slice(0, 16)
    this.peers.set(peerId, { socketId: client.id, roomId, name: safeName })
    this.socketToPeer.set(client.id, peerId)
    void client.join(roomId)

    const peers = [...this.peers.entries()]
      .filter(([, info]) => info.roomId === roomId && info.socketId !== client.id)
      .map(([id, info]) => ({ peerId: id, name: info.name }))

    // 已在房间内的成员收到新人加入
    client.to(roomId).emit('peer-joined', { peerId, name: safeName })

    return { ok: true, peers }
  }

  @SubscribeMessage('signal')
  signal(client: Socket, payload: { to: string; data: unknown }): void {
    const fromId = this.socketToPeer.get(client.id)
    if (!fromId || !payload?.to || !payload.data) return
    const target = this.peers.get(payload.to)
    if (!target) return
    this.server.to(target.socketId).emit('signal', { from: fromId, data: payload.data })
  }

  @SubscribeMessage('leave')
  leave(client: Socket): void {
    this.dropPeer(client)
  }

  handleDisconnect(client: Socket): void {
    this.dropPeer(client)
  }

  private dropPeer(client: Socket): void {
    const peerId = this.socketToPeer.get(client.id)
    this.socketToPeer.delete(client.id)
    if (!peerId) return
    const info = this.peers.get(peerId)
    this.peers.delete(peerId)
    if (info) {
      void client.leave(info.roomId)
      this.server.to(info.roomId).emit('peer-left', { peerId })
    }
  }
}
