import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import type {
  SrvAnnotationAdd,
  SrvAnnotationRemove,
  SrvAnnotationRestore,
  SrvAnnotationUpdate,
  SrvBoardClear,
  SrvEnvelope,
  SrvHostChange,
  SrvMapChange,
  SrvMemberOffline,
  SrvMemberOnline,
  SrvRoomArchived
} from '@shared/types'
import { useAuthStore } from './auth'
import { useBoardStore } from './board'

type AckResult<T> = { ok: true; data: T } | { ok: false; error: string }

function unwrap<T>(res: AckResult<T>): T {
  if (res.ok) return res.data
  throw new Error(res.error)
}

/** Socket.IO 连接与事件分发（任务 4.7/4.8） */
export const useRealtimeStore = defineStore('realtime', {
  state: () => ({
    socket: null as Socket | null,
    connected: false,
    connecting: false
  }),

  getters: {
    isConnected: (s) => s.connected
  },

  actions: {
    connect(): Socket {
      const auth = useAuthStore()
      const existing = this.socket
      if (existing) return existing

      const url = import.meta.env.VITE_WS_URL || 'http://localhost:3000'
      const socket = io(`${url}/board`, {
        auth: { token: auth.accessToken },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      })
      this.socket = socket

      const board = useBoardStore()
      socket.on('connect', () => {
        this.connected = true
        void board.resync()
      })
      socket.on('disconnect', () => {
        this.connected = false
      })
      socket.on('connect_error', () => {
        this.connected = false
      })

      // ---- 服务端广播事件：全部走 board.applyEvent 统一处理 ----
      socket.on('annotation:add', (e: SrvEnvelope<SrvAnnotationAdd>) => board.applyEvent('annotation:add', e))
      socket.on('annotation:update', (e: SrvEnvelope<SrvAnnotationUpdate>) => board.applyEvent('annotation:update', e))
      socket.on('annotation:remove', (e: SrvEnvelope<SrvAnnotationRemove>) => board.applyEvent('annotation:remove', e))
      socket.on('annotation:restore', (e: SrvEnvelope<SrvAnnotationRestore>) => board.applyEvent('annotation:restore', e))
      socket.on('board:clear', (e: SrvEnvelope<SrvBoardClear>) => board.applyEvent('board:clear', e))
      socket.on('map:change', (e: SrvEnvelope<SrvMapChange>) => board.applyEvent('map:change', e))
      socket.on('member:online', (e: SrvEnvelope<SrvMemberOnline>) => board.applyEvent('member:online', e))
      socket.on('member:offline', (e: SrvEnvelope<SrvMemberOffline>) => board.applyEvent('member:offline', e))
      socket.on('host:change', (e: SrvEnvelope<SrvHostChange>) => board.applyEvent('host:change', e))
      socket.on('room:archived', (e: SrvEnvelope<SrvRoomArchived>) => board.applyEvent('room:archived', e))

      return socket
    },

    disconnect(): void {
      const socket = this.socket
      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
      }
      this.socket = null
      this.connected = false
    },

    /** 带 ack 的事件发送 */
    async emit<T>(event: string, payload?: unknown): Promise<T> {
      const socket = this.socket
      if (!socket || !this.connected) throw new Error('实时连接未就绪')
      return await new Promise<T>((resolve, reject) => {
        socket.timeout(8000).emit(event, payload, (err: Error | null, res?: AckResult<T>) => {
          if (err) return reject(err)
          try {
            if (res === undefined) return reject(new Error('no-ack'))
            resolve(unwrap(res))
          } catch (e) {
            reject(e)
          }
        })
      })
    }
  }
})
