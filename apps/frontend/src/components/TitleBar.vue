<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { APP_VERSION, desktop } from '@/platform';

/** 桌面客户端自定义标题栏（无边框窗口），通过 window.fp 控制窗口 */
const maximized = ref(false);
let cleanup: (() => void) | undefined;

onMounted(() => {
  if (!desktop) return;
  void desktop.window.isMaximized().then((v) => {
    maximized.value = v;
  });
  desktop.window.onMaximized((v) => {
    maximized.value = v;
  });
  window.addEventListener('resize', sync);
  cleanup = () => window.removeEventListener('resize', sync);
});

function sync(): void {
  void desktop?.window.isMaximized().then((v) => {
    maximized.value = v;
  });
}

onBeforeUnmount(() => cleanup?.());
</script>

<template>
  <div class="win-titlebar">
    <div class="win-lights"><i></i><i></i><i></i></div>
    <div class="win-title">
      <span class="wicon">+</span><b>fighting+</b><span>战术协作系统</span><span class="win-badge">DESKTOP</span><em>v{{ APP_VERSION }}</em>
    </div>
    <div class="win-controls">
      <button aria-label="最小化" title="最小化" @click="desktop?.window.minimize()">
        <svg viewBox="0 0 14 14"><path d="M2 7h10"/></svg>
      </button>
      <button aria-label="最大化或还原" title="最大化 / 还原" @click="desktop?.window.toggleMaximize()">
        <svg v-if="!maximized" viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" rx="1"/></svg>
        <svg v-else viewBox="0 0 14 14"><path d="M4.5 4.5v-2h7v7h-2"/><rect x="2.5" y="4.5" width="7" height="7" rx="1"/></svg>
      </button>
      <button class="win-close" aria-label="关闭" title="关闭" @click="desktop?.window.close()">
        <svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>
  </div>
</template>
