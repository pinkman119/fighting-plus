<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')
const loading = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (mode.value === 'login') {
      await auth.login(email.value.trim(), password.value)
    } else {
      await auth.register(email.value.trim(), password.value, nickname.value.trim())
    }
    const redirect = (route.query.redirect as string) || '/'
    void router.push(redirect)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card panel">
      <h1 class="brand">fighting<span class="plus">-plus</span></h1>
      <p class="slogan">撤离小队共享战术板 · 看得见的位置情报</p>

      <div class="tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <form @submit.prevent="submit">
        <div class="form-row">
          <label>邮箱</label>
          <input v-model="email" type="email" required autocomplete="email" placeholder="you@example.com" />
        </div>
        <div class="form-row">
          <label>密码</label>
          <input v-model="password" type="password" required minlength="8" autocomplete="current-password" placeholder="至少 8 位" />
        </div>
        <div v-if="mode === 'register'" class="form-row">
          <label>昵称</label>
          <input v-model="nickname" required maxlength="16" placeholder="游戏中称呼（≤16 字符）" />
        </div>
        <div class="error-msg">{{ error }}</div>
        <button class="primary submit" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-card {
  width: 380px;
  padding: 28px;
}
.brand {
  font-size: 26px;
  color: var(--text);
}
.brand .plus {
  color: var(--accent);
}
.slogan {
  font-size: 12px;
  color: var(--text-dim);
  margin: 8px 0 18px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.tabs button {
  flex: 1;
}
.tabs button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.submit {
  width: 100%;
  padding: 9px;
  font-size: 14px;
}
</style>
