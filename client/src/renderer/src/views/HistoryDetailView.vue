<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiError, http } from '@/api/http'
import type { MatchDetail } from '@shared/types'
import TacticalCanvas from '@/components/TacticalCanvas.vue'

const route = useRoute()
const router = useRouter()
const detail = ref<MatchDetail | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const { data } = await http.get<MatchDetail>(`/matches/${route.params.matchId}`)
    detail.value = data
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="detail-root">
    <nav class="topnav">
      <span class="brand">fighting-plus</span>
      <span class="room-name">{{ detail?.name }}（历史局回放 · 只读）</span>
      <span class="spacer" />
      <button @click="router.push('/history')">返回列表</button>
    </nav>

    <div v-if="loading" class="center">加载中…</div>
    <div v-else-if="error" class="center">{{ error }}</div>
    <div v-else class="canvas-wrap">
      <TacticalCanvas :annotations="detail?.annotations ?? []" :map="detail?.map ?? null" :readonly="true" />
    </div>
  </div>
</template>

<style scoped>
.detail-root {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.room-name {
  font-weight: 600;
}
.center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}
.canvas-wrap {
  flex: 1;
  min-height: 0;
}
</style>
