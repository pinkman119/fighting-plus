import { onBeforeUnmount, onMounted, ref } from 'vue';

/** 每秒刷新的秒级时钟（组件卸载时自动清理） */
export function useTicker() {
  const now = ref(Math.floor(Date.now() / 1000));
  let timer: number | undefined;
  onMounted(() => {
    timer = window.setInterval(() => {
      now.value = Math.floor(Date.now() / 1000);
    }, 1000);
  });
  onBeforeUnmount(() => {
    if (timer != null) window.clearInterval(timer);
  });
  return { now };
}
