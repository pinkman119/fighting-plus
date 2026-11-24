<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiError, http } from '@/api/http'
import type { MatchSummary } from '@shared/types'

const route = useRoute()
const router = useRouter()
const matches = ref<MatchSummary[]>([])
const loading = ref(true)
const error = ref('')

const archivedNotice = ref((route.query.archived as string) || '')

onMounted(async () => {
  try {
    const { data } = await http.get<MatchSummary[]>('/matches')
    matches.value = data
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <nav class="topnav">
      <span class="brand">fighting-plus</span>
      <span class="spacer" />
      <router-link to="/">大厅</router-link>
    </nav>

    <div class="page">
      <h2 class="page-title">历史对局</h2>

      <div v-if="archivedNotice" class="panel archived-tip">
        对局已归档 ✓ 标注快照已保存，可在下方回看。
      </div>

      <div v-if="loading" style="color: var(--text-dim)">加载中…</div>
      <div class="error-msg">{{ error }}</div>

      <div v-if="!loading && matches.length === 0" class="panel" style="text-align: center; color: var(--text-dim)">
        还没有历史对局
      </div>

      <div
        v-for="m in matches"
        :key="m.id"
        class="panel match-row"
        @click="router.push(`/history/${m.id}`)"
      >
        <div class="match-main">
          <div class="match-name">{{ m.name }}</div>
          <div class="match-participants">
            <span v-for="p in m.participants" :key="p.userId" class="chip" :style="{ borderColor: p.color }">
              <i :style="{ background: p.color }" />{{ p.nickname }}
            </span>
          </div>
        </div>
        <div class="match-time">{{ new Date(m.endedAt).toLocaleString() }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.archived-tip {
  margin-bottom: 14px;
  color: #34d399;
  font-size: 13px;
}
.match-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.match-row:hover {
  border-color: var(--accent);
}
.match-main {
  flex: 1;
  min-width: 0;
}
.match-name {
  font-weight: 600;
  margin-bottom: 6px;
}
.match-participants {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  color: var(--text-dim);
}
.chip i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.match-time {
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
}
</style>
