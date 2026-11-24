import { defineStore } from 'pinia'
import type {
  Annotation,
  AnnotationPayload,
  AnnotationType,
  BoardSnapshot,
  MapInfo,
  RoomMemberInfo,
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
import { apiError, http } from '@/api/http'
import { useAuthStore } from './auth'
import { useRealtimeStore } from './realtime'

interface UndoEntry {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

const UNDO_LIMIT = 50

/** 共享战术板状态（任务 4.6-4.8） */
export const useBoardStore = defineStore('board', {
  state: () => ({
    roomId: null as string | null,
    name: '',
    inviteCode: '',
    hostId: '',
    map: null as MapInfo | null,
    annotations: [] as Annotation[],
    members: [] as RoomMemberInfo[],
    joined: false,
    joining: false,
    /** 本地撤销/重做栈（各自独立，互不同步） */
    undoStack: [] as UndoEntry[],
    redoStack: [] as UndoEntry[],
    archivedMatchId: null as string | null
  }),

  getters: {
    isHost(): boolean {
      return this.hostId === useAuthStore().user?.id
    },
    onlineCount: (s) => s.members.filter((m) => m.online).length
  },

  actions: {
    // ---------- 房间 ----------

    /** 加入房间并全量同步快照（含断线重连后的 resync） */
    async join(roomId: string): Promise<void> {
      const rt = useRealtimeStore()
      rt.connect()
      this.joining = true
      try {
        const snapshot = await rt.emit<BoardSnapshot>('room:join', { roomId })
        this.applySnapshot(snapshot)
        this.joined = true
        localStorage.setItem('fp:roomId', roomId)
        this.archivedMatchId = null
      } finally {
        this.joining = false
      }
    },

    /** Socket 重连后调用：重新 join 拉全量快照，保证与服务端一致（任务 4.8） */
    async resync(): Promise<void> {
      if (!this.roomId || !this.joined) return
      const rt = useRealtimeStore()
      try {
        const snapshot = await rt.emit<BoardSnapshot>('room:join', { roomId: this.roomId })
        this.applySnapshot(snapshot)
      } catch (e) {
        // 房间可能已归档
        this.joined = false
        throw e
      }
    },

    async leave(): Promise<void> {
      const rt = useRealtimeStore()
      try {
        if (rt.connected) await rt.emit('room:leave')
      } catch {
        // ignore
      }
      this.reset()
      localStorage.removeItem('fp:roomId')
    },

    reset(): void {
      this.roomId = null
      this.name = ''
      this.inviteCode = ''
      this.hostId = ''
      this.map = null
      this.annotations = []
      this.members = []
      this.joined = false
      this.undoStack = []
      this.redoStack = []
    },

    applySnapshot(snapshot: BoardSnapshot): void {
      this.roomId = snapshot.roomId
      this.name = snapshot.name
      this.inviteCode = snapshot.inviteCode
      this.hostId = snapshot.hostId
      this.map = snapshot.map
      this.annotations = [...snapshot.annotations].sort((a, b) => a.createdAt - b.createdAt)
      this.members = snapshot.members
      this.undoStack = []
      this.redoStack = []
    },

    // ---------- 服务端事件统一入口 ----------

    applyEvent(
      type: string,
      env: SrvEnvelope<
        | SrvAnnotationAdd
        | SrvAnnotationUpdate
        | SrvAnnotationRemove
        | SrvAnnotationRestore
        | SrvBoardClear
        | SrvMapChange
        | SrvMemberOnline
        | SrvMemberOffline
        | SrvHostChange
        | SrvRoomArchived
      >
    ): void {
      const d = env.data
      switch (type) {
        case 'annotation:add':
          if (!this.annotations.some((a) => a.id === (d as SrvAnnotationAdd).annotation.id)) {
            this.annotations.push((d as SrvAnnotationAdd).annotation)
          }
          break
        case 'annotation:update': {
          const u = d as SrvAnnotationUpdate
          const a = this.annotations.find((x) => x.id === u.id)
          if (a) a.note = u.patch.note
          break
        }
        case 'annotation:remove':
          this.annotations = this.annotations.filter((a) => a.id !== (d as SrvAnnotationRemove).id)
          break
        case 'annotation:restore': {
          const r = d as SrvAnnotationRestore
          for (const ann of r.annotations) {
            if (!this.annotations.some((a) => a.id === ann.id)) {
              this.annotations.push(ann)
            }
          }
          this.annotations.sort((a, b) => a.createdAt - b.createdAt)
          break
        }
        case 'board:clear':
          this.annotations = []
          break
        case 'map:change':
          this.map = (d as SrvMapChange).map
          break
        case 'member:online': {
          const m = (d as SrvMemberOnline).member
          const idx = this.members.findIndex((x) => x.userId === m.userId)
          if (idx >= 0) this.members[idx] = m
          else this.members.push(m)
          break
        }
        case 'member:offline': {
          const off = d as SrvMemberOffline
          const m = this.members.find((x) => x.userId === off.userId)
          if (m) m.online = false
          break
        }
        case 'host:change':
          this.hostId = (d as SrvHostChange).hostId
          for (const m of this.members) m.isHost = m.userId === this.hostId
          break
        case 'room:archived':
          this.joined = false
          this.archivedMatchId = (d as SrvRoomArchived).matchId
          break
      }
    },

    // ---------- 本地操作（走 socket + ack + 撤销栈） ----------

    private pushUndo(entry: UndoEntry): void {
      this.undoStack.push(entry)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
      this.redoStack = []
    },

    async addAnnotation(type: AnnotationType, payload: AnnotationPayload, note: string | null): Promise<void> {
      const rt = useRealtimeStore()
      const { id } = await rt.emit<{ id: string }>('annotation:add', { type, payload, note })
      const remove = async (): Promise<void> => {
        await rt.emit('annotation:remove', { id })
      }
      const restore = async (): Promise<void> => {
        await rt.emit('annotation:restore', { ids: [id] })
      }
      this.pushUndo({ label: 'add', undo: remove, redo: restore })
    },

    async removeAnnotation(id: string): Promise<void> {
      const rt = useRealtimeStore()
      await rt.emit('annotation:remove', { id })
      const restore = async (): Promise<void> => {
        await rt.emit('annotation:restore', { ids: [id] })
      }
      const remove = async (): Promise<void> => {
        await rt.emit('annotation:remove', { id })
      }
      this.pushUndo({ label: 'remove', undo: restore, redo: remove })
    },

    /** 一键清空（二次确认由界面处理；撤销可整批恢复） */
    async clearBoard(): Promise<void> {
      const rt = useRealtimeStore()
      const { removedIds } = await rt.emit<{ removedIds: string[] }>('board:clear')
      const restore = async (): Promise<void> => {
        await rt.emit('annotation:restore', { ids: removedIds })
      }
      const clear = async (): Promise<void> => {
        await rt.emit('board:clear')
      }
      this.pushUndo({ label: 'clear', undo: restore, redo: clear })
    },

    /** 撤销本地最近一次操作 */
    async undo(): Promise<void> {
      const entry = this.undoStack.pop()
      if (!entry) return
      await entry.undo()
      this.redoStack.push(entry)
    },

    async redo(): Promise<void> {
      const entry = this.redoStack.pop()
      if (!entry) return
      await entry.redo()
      this.undoStack.push(entry)
    },

    // ---------- 地图上传（任务 4.1） ----------

    async uploadMap(file: File): Promise<void> {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('图片解析失败'))
        el.src = URL.createObjectURL(file)
      })

      const form = new FormData()
      form.append('file', file)
      const { data } = await http.post<{ url: string }>('/maps', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      const rt = useRealtimeStore()
      await rt.emit('map:change', { url: data.url, width: img.naturalWidth, height: img.naturalHeight })
      this.map = { url: data.url, width: img.naturalWidth, height: img.naturalHeight }
    },

    // ---------- 房主操作 ----------

    async transferHost(targetUserId: string): Promise<void> {
      const rt = useRealtimeStore()
      await rt.emit('host:transfer', { targetUserId })
      this.hostId = targetUserId
    },

    async archive(): Promise<string> {
      const { data } = await http.post<{ matchId: string }>(`/rooms/${this.roomId}/archive`)
      this.joined = false
      this.archivedMatchId = data.matchId
      return data.matchId
    }
  }
})

export { apiError }
