<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const AVATARS = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6']
const EMOJI: Record<string, string> = {
  'avatar-1': '🦊',
  'avatar-2': '🐺',
  'avatar-3': '🦅',
  'avatar-4': '🐻',
  'avatar-5': '🐯',
  'avatar-6': '🦁'
}

const nickname = ref(auth.user?.nickname ?? '')
const avatar = ref(auth.user?.avatar ?? 'avatar-1')
const error = ref('')
const saved = ref(false)

watch(
  () => auth.user,
  (u) => {
    if (u) {
      nickname.value = u.nickname
      avatar.value = u.avatar
    }
  }
)

async function save(): Promise<void> {
  error.value = ''
  try {
    await auth.updateProfile({ nickname: nickname.value.trim(), avatar: avatar.value })
    saved.value = true
    window.setTimeout(() => (saved.value = false), 1500)
  } catch (e) {
    error.value = apiError(e)
  }
}
</script>

<template>
  <div>
    <nav class="topnav">
      <span class="brand">fighting-plus</span>
      <span class="spacer" />
      <router-link to="/">大厅</router-link>
      <router-link to="/history">历史对局</router-link>
    </nav>

    <div class="page" style="max-width: 520px">
      <h2 class="page-title">账号资料</h2>
      <div class="panel">
        <div class="form-row">
          <label>邮箱（不可修改）</label>
          <input :value="auth.user?.email" disabled />
        </div>
        <div class="form-row">
          <label>昵称（≤16 字符，房间内展示）</label>
          <input v-model="nickname" maxlength="16" />
        </div>
        <div class="form-row">
          <label>头像</label>
          <div class="avatars">
            <button
              v-for="a in AVATARS"
              :key="a"
              :class="{ active: avatar === a }"
              @click="avatar = a"
            >
              {{ EMOJI[a] }}
            </button>
          </div>
        </div>
        <div class="error-msg">{{ error }}</div>
        <button class="primary" @click="save">{{ saved ? '已保存 ✓' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.avatars {
  display: flex;
  gap: 8px;
}
.avatars button {
  font-size: 22px;
  padding: 6px 10px;
}
.avatars button.active {
  border-color: var(--accent);
  background: #1d2a3a;
}
</style>
