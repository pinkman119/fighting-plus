<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
// Overlay 窗口与普通窗口共用本 App，按路由区分布局
const bareLayout = computed(() => route.path === '/overlay' || route.path === '/login')
</script>

<template>
  <div class="app-root" :class="{ 'bare-root': bareLayout, 'overlay-root': route.path === '/overlay' }">
    <router-view />
  </div>
</template>
