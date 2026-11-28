<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { copyText } from '@/lib/clipboard';
import { showToast } from '@/stores/ui';

const props = withDefaults(
  defineProps<{
    text: string;
    label?: string;
    /** default：大厅琥珀色按钮；debug：调试面板内的紧凑按钮 */
    variant?: 'default' | 'debug';
    title?: string;
  }>(),
  { label: '复制', variant: 'default', title: undefined },
);

const done = ref(false);
let timer: number | undefined;

async function onClick(): Promise<void> {
  const ok = await copyText(props.text);
  if (!ok) {
    showToast('复制失败，请手动选择', 'error');
    return;
  }
  done.value = true;
  showToast('已复制到剪贴板');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    done.value = false;
  }, 1600);
}

onBeforeUnmount(() => window.clearTimeout(timer));
</script>

<template>
  <button
    type="button"
    :class="[variant === 'debug' ? 'debug-copy' : 'copy-btn', { done }]"
    :title="title ?? '复制'"
    :aria-label="title ?? '复制'"
    @click="onClick"
  >
    <svg viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/></svg>
    <span>{{ done ? '已复制' : label }}</span>
  </button>
</template>
