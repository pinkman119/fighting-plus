<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiError, http } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useBoardStore } from '@/stores/board'
import { useRealtimeStore } from '@/stores/realtime'
import type { RoomInfo } from '@shared/types'

const auth = useAuthStore()
const board = useBoardStore()
const rt = useRealtimeStore()
const router = useRouter()

const newRoomName = ref('')
const joinCode = ref('')
const error = ref('')
const creating = ref(false)
const joining = ref(false)

async function createRoom(): Promise<void> {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    const { data } = await http.post<RoomInfo>('/rooms', { name: newRoomName.value || undefined })
    await enterRoom(data)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    creating.value = false
  }
}

async function joinRoom(): Promise<void> {
  if (joining.value) return
  joining.value = true
  error.value = ''
  try {
    const { data } = await http.post<RoomInfo>('/rooms/join', { inviteCode: joinCode.value.trim().toUpperCase() })
    await enterRoom(data)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    joining.value = false
  }
}

async function enterRoom(room: RoomInfo): Promise<void> {
  rt.connect()
  await board.join(room.id)
  void router.push(`/rooms/${room.id}`)
}

async function logout(): Promise<void> {
  rt.disconnect()
  await auth.logout()
  void router.push('/login')
}
</script>

<template>
  <div>
    <nav class="topnav">
      <span class="brand">fighting-plus</span>
      <span class="spacer" />
      <router-link to="/history">历史对局</router-link>
      <router-link to="/profile">{{ auth.user?.nickname }} 的资料</router-link>
      <button @click="logout">退出登录</button>
    </nav>

    <div class="page">
      <h2 class="page-title">战术板大厅</h2>

      <div class="grid">
        <div class="panel">
          <h3>创建房间</h3>
          <p class="hint">建房后把邀请码发给队友（上限 6 人）</p>
          <div class="form-row">
            <label>对局名称（可选）</label>
            <input v-model="newRoomName" maxlength="32" placeholder="如：今天晚上8点排位" @keyup.enter="createRoom" />
          </div>
          <button class="primary" :disabled="creating" @click="createRoom">
            {{ creating ? '创建中…' : '创建房间' }}
          </button>
        </div>

        <div class="panel">
          <h3>加入房间</h3>
          <p class="hint">输入队友分享的邀请码</p>
          <div class="form-row">
            <label>邀请码</label>
            <input
              v-model="joinCode"
              maxlength="6"
              placeholder="如：7K2M9A"
              style="text-transform: uppercase; letter-spacing: 4px"
              @keyup.enter="joinRoom"
            />
          </div>
          <button class="primary" :disabled="joining" @click="joinRoom">
            {{ joining ? '加入中…' : '加入房间' }}
          </button>
        </div>
      </div>

      <div class="error-msg" style="margin-top: 14px">{{ error }}</div>

      <div class="panel" style="margin-top: 24px">
        <h3>Overlay 提示</h3>
        <p class="hint">游戏中按 <b>Alt+Q</b> 呼出半透明战术板悬浮窗（游戏需以“无边框窗口”模式运行）。Overlay 仅展示标注，编辑请在主窗口进行。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
h3 {
  font-size: 15px;
  margin-bottom: 6px;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 14px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
</style>
