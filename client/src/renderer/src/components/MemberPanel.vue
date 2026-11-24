<script setup lang="ts">
import { computed } from 'vue'
import type { RoomMemberInfo } from '@shared/types'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  members: RoomMemberInfo[]
  hostId: string
  myUserId: string | null
}>()

const emit = defineEmits<{
  (e: 'transfer-host', userId: string): void
}>()

const auth = useAuthStore()
const iAmHost = computed(() => auth.user?.id === props.hostId)
const avatarEmoji: Record<string, string> = {
  'avatar-1': '🦊',
  'avatar-2': '🐺',
  'avatar-3': '🦅',
  'avatar-4': '🐻',
  'avatar-5': '🐯',
  'avatar-6': '🦁'
}
</script>

<template>
  <div class="member-panel panel">
    <div class="panel-title">成员（{{ members.length }}/6）</div>
    <div v-for="m in members" :key="m.userId" class="member" :class="{ offline: !m.online, me: m.userId === myUserId }">
      <span class="dot" :style="{ background: m.color }" />
      <span class="avatar">{{ avatarEmoji[m.avatar] ?? '👤' }}</span>
      <span class="nickname">{{ m.nickname }}{{ m.userId === myUserId ? '（我）' : '' }}</span>
      <span v-if="m.isHost" class="host-tag">房主</span>
      <span class="online-tag">{{ m.online ? '在线' : '离线' }}</span>
      <button
        v-if="iAmHost && !m.isHost && m.userId !== myUserId"
        class="mini"
        title="移交房主"
        @click="emit('transfer-host', m.userId)"
      >
        移交
      </button>
    </div>
    <div v-if="members.length === 0" class="empty">暂无成员</div>
  </div>
</template>

<style scoped>
.member-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow-y: auto;
}
.panel-title {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.member {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--panel-2);
}
.member.offline {
  opacity: 0.45;
}
.member.me {
  border: 1px dashed var(--accent);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.avatar {
  font-size: 15px;
}
.nickname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host-tag {
  font-size: 10px;
  color: #fbbf24;
  border: 1px solid #fbbf24;
  border-radius: 4px;
  padding: 0 4px;
  flex: none;
}
.online-tag {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-dim);
  flex: none;
}
button.mini {
  font-size: 11px;
  padding: 2px 8px;
  flex: none;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  padding: 12px 0;
}
</style>
