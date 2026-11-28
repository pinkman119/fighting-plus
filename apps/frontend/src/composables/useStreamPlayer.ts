import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { createStreamPlayer, type StreamPlayer } from '@/lib/player';

export type StreamStatus = 'offline' | 'connecting' | 'playing' | 'error';

const MAX_RETRY_MS = 5000;

/**
 * 把一路拉流绑定到 video 元素：
 * 在线时自动播放，离线时自动停止，中途出错按指数退避重试。
 */
export function useStreamPlayer(video: Ref<HTMLVideoElement | null>, live: () => boolean, playToken: () => string) {
  const status = ref<StreamStatus>('offline');
  const latency = ref<number | null>(null);

  let player: StreamPlayer | null = null;
  let retryTimer: number | undefined;
  let latencyTimer: number | undefined;
  let watchdogTimer: number | undefined;
  let retryAttempt = 0;
  let recoveryCount = 0;
  let startSeq = 0;

  function clearTimers(): void {
    window.clearTimeout(retryTimer);
    window.clearInterval(latencyTimer);
    window.clearTimeout(watchdogTimer);
    retryTimer = undefined;
    latencyTimer = undefined;
    watchdogTimer = undefined;
  }

  function stop(): void {
    startSeq++;
    clearTimers();
    retryAttempt = 0;
    player?.destroy();
    player = null;
    status.value = 'offline';
    latency.value = null;
  }

  function fail(): void {
    if (!live()) {
      stop();
      return;
    }
    startSeq++;
    clearTimers();
    player?.destroy();
    player = null;
    status.value = 'error';
    latency.value = null;
    const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** retryAttempt);
    retryAttempt = Math.min(retryAttempt + 1, 3);
    retryTimer = window.setTimeout(start, delay);
  }

  function start(): void {
    if (player || !live() || !playToken()) return;
    clearTimers();
    const seq = ++startSeq;
    status.value = 'connecting';
    void nextTick(() => {
      const v = video.value;
      if (seq !== startSeq || player || !v || !live()) return;
      player = createStreamPlayer(v, playToken(), fail);
      retryAttempt = 0;
      latencyTimer = window.setInterval(() => {
        latency.value = player?.getLatencyMs() ?? null;
      }, 1000);
      watchdogTimer = window.setTimeout(() => {
        const el = video.value;
        const lag = player?.getLatencyMs() ?? 0;
        const stalled = !el || el.readyState < 2 || !el.videoWidth || lag > 3000;
        if (!stalled) {
          recoveryCount = 0;
          return;
        }
        if (recoveryCount < 2) {
          recoveryCount++;
          restart();
        }
      }, 4000);
    });
  }

  /** 手动重新拉流：清掉当前播放器、重试计时器后立即重建 */
  function restart(): void {
    stop();
    start();
  }

  watch(live, (on) => {
    if (on) start();
    else {
      recoveryCount = 0;
      stop();
    }
  }, { immediate: true });
  onBeforeUnmount(stop);

  return { status, latency, restart };
}
