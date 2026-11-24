<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useBoardStore } from '@/stores/board'
import TacticalCanvas, { type ToolId } from '@/components/TacticalCanvas.vue'
import ToolBar from '@/components/ToolBar.vue'
import MemberPanel from '@/components/MemberPanel.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const board = useBoardStore()

const tool = ref<ToolId>('pan')
const zoneShape = ref<'rect' | 'circle'>('rect')
const pinNote = ref('')
const showClearConfirm = ref(false)
const showArchiveConfirm = ref(false)
const error = ref('')
const copied = ref(false)
const connectionLost = ref(false)
const starting = ref(true)

const roomId = computed(() => route.params.id as string)

onMounted(async () => {
  try {
    if (board.roomId !== roomId.value) {
      await board.join(roomId.value)
    }
    starting.value = false
  } catch (e) {
    error.value = apiError(e)
    starting.value = false
  }

  // Ctrl+Z / Ctrl+Y（任务 4.6）
  window.addEventListener('keydown', onKeydown)

  // 房间归档提示 → 回大厅（任务 3.4）
  const timer = window.setInterval(() => {
    if (board.archivedMatchId) {
      window.clearInterval(timer)
      const mid = board.archivedMatchId
      board.reset()
      void router.push({ path: '/history', query: { archived: mid } })
    }
    connectionLost.value = !board.joined && !starting.value
  }, 500)
  onBeforeUnmount(() => window.clearInterval(timer))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  void board.leave()
})

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    void board.undo()
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault()
    void board.redo()
  }
}

async function onAdd(_type: 'pin' | 'arrow' | 'zone', payload: unknown): Promise<void> {
  try {
    await board.addAnnotation(_type, payload as never, pinNote.value.trim() || null)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function onRemove(id: string): Promise<void> {
  try {
    await board.removeAnnotation(id)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function onUploadMap(file: File): Promise<void> {
  try {
    await board.uploadMap(file)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function confirmClear(): Promise<void> {
  showClearConfirm.value = false
  try {
    await board.clearBoard()
  } catch (e) {
    error.value = apiError(e)
  }
}

async function confirmArchive(): Promise<void> {
  showArchiveConfirm.value = false
  try {
    const matchId = await board.archive()
    board.reset()
    void router.push({ path: '/history', query: { archived: matchId } })
  } catch (e) {
    error.value = apiError(e)
  }
}

async function onTransferHost(userId: string): Promise<void> {
  try {
    await board.transferHost(userId)
  } catch (e) {
    error.value = apiError(e)
  }
}

function copyInvite(): void {
  void navigator.clipboard.writeText(board.inviteCode)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

async function resync(): Promise<void> {
  try {
    await board.join(roomId.value)
    connectionLost.value = false
  } catch (e) {
    error.value = apiError(e)
  }
}
</script>

<template>
  <div class="room-root">
    <nav class="topnav">
      <span class="brand">fighting-plus</span>
      <span class="room-name">{{ board.name }}</span>
      <span class="invite" title="点击复制邀请码" @click="copyInvite">
        邀请码 <b>{{ board.inviteCode }}</b> <i>{{ copied ? '已复制' : '复制' }}</i>
      </span>
      <span class="spacer" />
      <span v-if="!board.joined" class="conn-lost">连接中断</span>
      <button v-if="!board.joined" class="primary" @click="resync">重新连接</button>
      <button v-if="board.isHost" class="danger" @click="showArchiveConfirm = true">结束对局</button>
      <button @click="router.push('/')">离开房间</button>
    </nav>

    <div v-if="starting" class="center-msg">正在加入房间…</div>
    <div v-else-if="error && !board.joined" class="center-msg">{{ error }}</div>

    <div v-else class="room-main">
      <aside class="side">
        <MemberPanel :members="board.members" :host-id="board.hostId" :my-user-id="auth.user?.id ?? null" @transfer-host="onTransferHost" />
      </aside>

      <section class="board">
        <ToolBar
          v-model:tool="tool"
          v-model:zone-shape="zoneShape"
          v-model:pin-note="pinNote"
          v-model:show-clear-confirm="showClearConfirm"
          @upload-map="onUploadMap"
          @undo="board.undo()"
          @redo="board.redo()"
          @clear="confirmClear"
        />
        <div class="canvas-area">
          <TacticalCanvas
            :annotations="board.annotations"
            :map="board.map"
            :tool="tool"
            :zone-shape="zoneShape"
            @add="onAdd"
            @remove="onRemove"
          />
          <div v-if="error" class="toast error">{{ error }}</div>
        </div>
      </section>
    </div>

    <!-- 清空确认（任务 4.6） -->
    <div v-if="showClearConfirm" class="modal-mask">
      <div class="panel modal">
        <h3>清空全部标注？</h3>
        <p class="hint">将删除房间内所有标注（可 Ctrl+Z 整批撤销恢复）。</p>
        <div class="modal-actions">
          <button @click="showClearConfirm = false">取消</button>
          <button class="danger" @click="confirmClear">确认清空</button>
        </div>
      </div>
    </div>

    <!-- 归档确认 -->
    <div v-if="showArchiveConfirm" class="modal-mask">
      <div class="panel modal">
        <h3>结束对局？</h3>
        <p class="hint">对局将归档为历史局，当前标注生成快照供回看。</p>
        <div class="modal-actions">
          <button @click="showArchiveConfirm = false">取消</button>
          <button class="danger" @click="confirmArchive">结束并归档</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-root {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.room-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.side {
  width: 240px;
  padding: 12px;
  border-right: 1px solid var(--border);
  min-height: 0;
}
.board {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.canvas-area {
  flex: 1;
  position: relative;
  min-height: 0;
}
.room-name {
  font-weight: 600;
}
.invite {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-dim);
}
.invite b {
  color: #fbbf24;
  letter-spacing: 2px;
  margin: 0 2px;
}
.invite i {
  font-style: normal;
  font-size: 11px;
  color: var(--accent);
}
.conn-lost {
  color: var(--danger);
  font-size: 12px;
}
.center-msg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}
.toast {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  background: #2a1518;
  border: 1px solid var(--danger);
  color: #fca5a5;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 340px;
}
.modal h3 {
  margin-bottom: 8px;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 14px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
