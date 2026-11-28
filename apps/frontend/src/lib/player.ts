import mpegts from 'mpegts.js';
import { mediaUrl } from '@/platform';

export interface StreamPlayer {
  destroy(): void;
  /** 估算的播放缓冲延迟（毫秒），不可用时返回 null */
  getLatencyMs(): number | null;
}

/**
 * 创建一路直播播放器：
 * 优先 HTTP-FLV（mpegts.js，低延迟），不支持 MSE 的环境（iOS）回退原生 HLS。
 */
export function createStreamPlayer(
  video: HTMLVideoElement,
  playToken: string,
  onError: () => void,
): StreamPlayer {
  const flvUrl = mediaUrl(`/live/${encodeURIComponent(playToken)}.flv`);
  const hlsUrl = mediaUrl(`/live/${encodeURIComponent(playToken)}.m3u8`);

  let canFlv = false;
  try {
    canFlv = mpegts.isSupported() && Boolean(mpegts.getFeatureList().mseLivePlayback);
  } catch {
    canFlv = false;
  }

  if (canFlv) {
    const player = mpegts.createPlayer(
      { type: 'flv', isLive: true, url: flvUrl, cors: true },
      { enableWorker: false, liveBufferLatencyChasing: true, stashInitialSize: 128, lazyLoad: false },
    );
    player.on(mpegts.Events.ERROR, onError);
    player.on(mpegts.Events.LOADING_COMPLETE, onError);
    player.attachMediaElement(video);
    player.load();
    video.play().catch(() => {
      /* 静音自动播放，一般不会被拦截 */
    });

    return {
      destroy() {
        try {
          player.pause();
          player.unload();
          player.detachMediaElement();
          player.destroy();
        } catch {
          /* ignore */
        }
        video.removeAttribute('src');
        video.load();
      },
      getLatencyMs() {
        return readLatency(player as unknown as { buffered?: TimeRanges; currentTime?: number });
      },
    };
  }

  video.src = hlsUrl;
  video.play().catch(() => {
    /* ignore */
  });
  const onErrorNative = () => onError();
  video.addEventListener('error', onErrorNative);
  return {
    destroy() {
      video.removeEventListener('error', onErrorNative);
      video.removeAttribute('src');
      video.load();
    },
    getLatencyMs() {
      return readLatency(video);
    },
  };
}

function readLatency(src: { buffered?: TimeRanges; currentTime?: number }): number | null {
  try {
    const buffered = src.buffered;
    const current = src.currentTime ?? Number.NaN;
    if (!buffered || typeof buffered.length !== 'number' || buffered.length === 0 || !Number.isFinite(current)) {
      return null;
    }
    const latency = buffered.end(buffered.length - 1) - current;
    if (!Number.isFinite(latency) || latency < 0 || latency > 120) return null;
    return Math.round(latency * 1000);
  } catch {
    return null;
  }
}
