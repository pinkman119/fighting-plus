import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export interface VideoMetrics {
  width: number | null;
  height: number | null;
  fps: number | null;
}

/**
 * 采集 video 元素的真实分辨率与帧率（每秒统计一次渲染帧数）。
 */
export function useVideoMetrics(video: Ref<HTMLVideoElement | null>) {
  const metrics = ref<VideoMetrics>({ width: null, height: null, fps: null });
  let timer: number | undefined;
  let lastFrames = 0;

  const sample = () => {
    const v = video.value;
    if (!v || v.paused || v.readyState < 2) {
      if (!v || v.ended) metrics.value = { width: null, height: null, fps: null };
      return;
    }
    const width = v.videoWidth || null;
    const height = v.videoHeight || null;
    let fps: number | null = null;
    try {
      const q = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
      const total = q?.totalVideoFrames;
      if (typeof total === 'number' && Number.isFinite(total)) {
        if (lastFrames > 0 && total >= lastFrames) fps = total - lastFrames;
        lastFrames = total;
      }
    } catch {
      fps = null;
    }
    if (metrics.value.width !== width || metrics.value.height !== height || metrics.value.fps !== fps) {
      metrics.value = { width, height, fps };
    }
  };

  onMounted(() => {
    timer = window.setInterval(sample, 1000);
  });
  onBeforeUnmount(() => {
    if (timer != null) window.clearInterval(timer);
  });

  return { metrics };
}
