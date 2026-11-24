<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { BoardSnapshot } from '@shared/types'
import { useAuthStore } from '@/stores/auth'
import { useBoardStore } from '@/stores/board'
import { useRealtimeStore } from '@/stores/realtime'
import TacticalCanvas from '@/components/TacticalCanvas.vue'

const auth = useAuthStore()
const board = useBoardStore()
const rt = useRealtimeStore()
const router = useRouter()

const status = ref<'loading' | 'ready' | 'no-room' | 'archived' | 'auth-failed'>('loading')
const clickThrough = ref(true)
const showGuide = ref(localStorage.getItem('fp:overlay-guide') !== 'done')

const electronBridge = (window as unknown as {
  electronAPI?: { setClickThrough(v: boolean): void }
}).electronAPI

function applyClickThrough(v: boolean): void {
  clickThrough.value = v
  electronBridge?.setClickThrough(v)
}

function dismissGuide(): void {
  showGuide.value = false
  localStorage.setItem('fp:overlay-guide', 'done')
}

onMounted(async () => {
  // Overlay 与主窗口是两个进程上下文：各自建立 Socket 连接（服务端按用户聚合在线状态）
  const roomId = localStorage.getItem('fp:roomId')
  await auth.ensureInitialized()
  if (!auth.isAuthenticated) {
    status.value = 'auth-failed'
    return
  }
  if (!roomId) {
    status.value = 'no-room'
    return
  }
  try {
    rt.connect()
    await board.join(roomId) // 拉全量快照
    status.value = 'ready'
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('archived') || msg.includes('not-available')) {
      status.value = 'archived'
    } else {
      status.value = 'no-room'
    }
  }
})

onBeforeUnmount(() => {
  board.reset()
  rt.disconnect()
  // 回大厅逻辑：房间归档时提示
  void router
})

function closeOverlay(): void {
  // 无标题栏：点击穿透态下热键 Alt+Q 隐藏；这里提供浏览器级退出兜底
  window.close()
}
</script>

<template>
  <div class="ov-root" :class="{ 'pointer-through': clickThrough && status === 'ready' }">
    <!-- 顶部提示条：穿透态点击不进来（forward hover 使按钮 hover 可见） -->
    <div class="ov-bar">
      <span class="ov-title">fighting-plus · 战术板 Overlay</span>
      <span class="spacer" />
      <span v-if="status === 'ready'" class="ov-status">{{ board.name }} · {{ board.onlineCount }} 人在线</span>
      <button v-if="status === 'ready'" class="mini" :class="{ on: !clickThrough }" title="切换点击穿透" @click="applyClickThrough(!clickThrough)">
        {{ clickThrough ? '穿透中（点击操作游戏）' : '可点击（可删除标注）' }}
      </button>
      <button v-else class="mini" @click="closeOverlay">关闭</button>
    </div>

    <div class="ov-body">
      <TacticalCanvas
        v-if="status === 'ready'"
        :annotations="board.annotations"
        :map="board.map"
        :readonly="true"
        @remove="board.removeAnnotation"
      />

      <div v-else class="ov-msg">
        <template v-if="status === 'loading'">连接战术板…</template>
        <template v-else-if="status === 'no-room'">主窗口尚未进入房间，先进房再呼出 Overlay</template>
        <template v-else-if="status === 'archived'">对局已结束</template>
        <template v-else-if="status === 'auth-failed'">请先在主窗口登录</template>
      </div>
    </div>

    <!-- 首次使用引导（任务 5.5）：无边框窗口模式提示 -->
    <div v-if="showGuide" class="ov-guide-mask">
      <div class="ov-guide">
        <h3>Overlay 使用提示</h3>
        <p>1. 游戏画面设置中把显示模式改为「<b>无边框窗口</b>」，全屏独占模式下 Overlay 无法显示。</p>
        <p>2. 游戏中按 <b>Alt+Q</b> 随时呼出/隐藏 Overlay。</p>
        <p>3. Overlay 仅展示队友标注；编辑请在主窗口进行，标注删除需先关闭点击穿透。</p>
        <p>4. 本软件不注入游戏进程，零封号风险。</p>
        <button class="primary" @click="dismissGuide">知道了</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(59, 130, 246, 0.55);
  border-radius: 8px;
  overflow: hidden;
}
.ov-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(23, 28, 34, 0.92);
  border-bottom: 1px solid rgba(59, 130, 246, 0.55);
  font-size: 12px;
  flex: none;
  -webkit-app-region: no-drag;
}
.ov-title {
  color: var(--accent);
  font-weight: 700;
}
.spacer {
  flex: 1;
}
.ov-status {
  color: var(--text-dim);
}
button.mini {
  font-size: 11px;
  padding: 3px 10px;
}
button.mini.on {
  border-color: #fbbf24;
  color: #fbbf24;
}
.ov-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.ov-msg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 13px;
}
.ov-guide-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.ov-guide {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px 24px;
  width: 400px;
}
.ov-guide h3 {
  margin-bottom: 10px;
}
.ov-guide p {
  font-size: 13px;
  color: var(--text);
  line-height: 1.7;
  margin-bottom: 6px;
}
.ov-guide button {
  margin-top: 12px;
  width: 100%;
}
</style>
