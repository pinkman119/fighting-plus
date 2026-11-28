<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { fmtBitrate, fmtClock, fmtCodec, uid } from '@/lib/format';
import { useTicker } from '@/composables/useTicker';
import { useVideoMetrics } from '@/composables/useVideoMetrics';
import { useStreamPlayer } from '@/composables/useStreamPlayer';
import { useRoom, roomState } from '@/stores/room';
import { showToast } from '@/stores/ui';
import CopyButton from '@/components/CopyButton.vue';

const { selfMember, selfLive } = useRoom();
const { now } = useTicker();

const streamEl = ref<HTMLVideoElement | null>(null);
const screenEl = ref<HTMLDivElement | null>(null);
const isFullscreen = ref(false);
const { metrics } = useVideoMetrics(streamEl);
const { status, latency, restart } = useStreamPlayer(
  streamEl,
  () => selfLive.value,
  () => selfMember.value?.playToken ?? '',
);

const localPings = ref<{ id: string; x: number; y: number }[]>([]);

const clock = computed(() => {
  const since = selfMember.value?.stream.onlineSince;
  if (!selfLive.value || !since) return '00:00:00';
  return fmtClock((now.value * 1000 - since) / 1000);
});

const bitrate = computed(() => fmtBitrate(selfMember.value?.stream.bitrateKbps));

/** "1920×1080 · 60FPS · H.264" */
const footDetail = computed(() => {
  const m = metrics.value;
  const size = m.width && m.height ? `${m.width}×${m.height}` : '--';
  const fps = m.fps != null ? `${m.fps}FPS` : '--FPS';
  return `${size} · ${fps} · ${fmtCodec(selfMember.value?.stream.videoCodec)}`;
});

const videoState = computed(() => {
  const m = metrics.value;
  if (!selfLive.value) return { text: '○ 未推流', ok: false };
  if (status.value === 'error') return { text: '● 播放错误', ok: false };
  if (!m.width || !m.height) return { text: '○ 未解码到视频帧', ok: false };
  return { text: `● ${m.width}×${m.height} · ${m.fps ?? '--'}FPS`, ok: true };
});

function onScreenClick(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  const id = uid();
  localPings.value.push({ id, x, y });
  window.setTimeout(() => {
    localPings.value = localPings.value.filter((p) => p.id !== id);
  }, 1100);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function syncFullscreen(): void {
  isFullscreen.value = document.fullscreenElement === screenEl.value;
}

async function toggleFullscreen(): Promise<void> {
  const el = screenEl.value;
  if (!el) return;
  try {
    if (document.fullscreenElement === el) {
      await document.exitFullscreen();
    } else {
      await el.requestFullscreen();
    }
  } catch {
    showToast('全屏切换失败，请检查浏览器权限', 'error');
  }
}

function onRefresh(): void {
  if (!selfLive.value) {
    showToast('当前未推流，无需刷新', 'error');
    return;
  }
  restart();
  showToast('正在重新拉取调试画面');
}

onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen));
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen);
  if (document.fullscreenElement === screenEl.value) void document.exitFullscreen();
});
</script>

<template>
  <article class="feed feed-debug">
    <div class="feed-head">
      <div class="peer">
        <span class="peer-id">{{ roomState.self?.callsign }}</span>
        <span class="peer-name">{{ selfMember?.feedLabel || 'OBS 采集画面' }} · 队友可见</span>
      </div>
      <div class="feed-tools">
        <span v-if="selfLive" class="live-tag">LIVE</span>
        <span class="debug-tag">DEBUG</span>
        <button
          class="debug-refresh-btn"
          :disabled="!selfLive"
          aria-label="刷新调试画面"
          title="重新拉取画面"
          @click="onRefresh"
        >
          <svg viewBox="0 0 16 16">
            <path d="M13.2 6.2A5.2 5.2 0 1 0 13 10" />
            <path d="M13.2 2.8v3.4H9.8" />
          </svg>
        </button>
        <button
          class="debug-fullscreen-btn"
          :class="{ on: isFullscreen }"
          :aria-label="isFullscreen ? '退出调试画面全屏' : '调试画面全屏'"
          :title="isFullscreen ? '退出全屏 (Esc)' : '调试画面全屏'"
          @click="toggleFullscreen"
        >
          <svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
        </button>
      </div>
    </div>

    <div class="debug-body">
      <div ref="screenEl" class="screen screen-self" data-screen @click="onScreenClick">
        <div class="debug-banner"><i></i>调试模式 · 当前画面为 OBS 推流，队友可见</div>
        <button
          v-if="isFullscreen"
          class="screen-fullscreen-exit"
          aria-label="退出全屏"
          title="退出全屏 (Esc)"
          @click.stop="toggleFullscreen"
        >
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>

        <video
          ref="streamEl"
          v-show="selfLive"
          class="stream-video"
          muted
          autoplay
          playsinline
          @playing="status = 'playing'"
          @waiting="status = 'connecting'"
        ></video>

        <div v-if="!selfLive" class="no-signal">
          <div class="ns-id">{{ roomState.self?.callsign }}</div>
          <div class="ns-title">NO SIGNAL · 等待 OBS 推流</div>
          <div class="ns-hint">在 OBS 中填入服务器与串流密钥并开始推流，你和 B / C 都能看到此画面</div>
        </div>
        <div v-else-if="status === 'error'" class="no-signal">
          <div class="ns-id">{{ roomState.self?.callsign }}</div>
          <div class="ns-title">SIGNAL LOST · 正在重连</div>
          <div class="ns-hint">画面暂时中断，正在自动恢复</div>
        </div>

        <div class="self-frame">
          <div class="self-grid"></div>
          <div class="self-scan"></div>
          <div class="self-reticle"><i></i></div>
          <div class="self-cam"><span>CAM</span><b>{{ roomState.self?.callsign }}</b></div>
        </div>

        <span v-for="p in localPings" :key="p.id" class="ping" :style="{ left: pct(p.x), top: pct(p.y) }"></span>
      </div>

      <div class="debug-info" aria-label="房间与推流调试信息">
        <div class="debug-info-head"><b>房间信息 · ROOM INFO</b><span>DEBUG FEED</span></div>

        <div class="debug-row inline">
          <span class="dk">房间码 · ROOM CODE</span>
          <b class="dv">{{ roomState.room?.code }}</b>
          <CopyButton variant="debug" :text="roomState.room?.code ?? ''" title="复制房间码" />
        </div>
        <div class="debug-row inline">
          <span class="dk">房间密码 · PASSCODE</span>
          <b class="dv">{{ roomState.room?.passcode }}</b>
          <CopyButton variant="debug" :text="roomState.room?.passcode ?? ''" title="复制房间密码" />
        </div>
        <div class="debug-row">
          <span class="dk">OBS 服务器 · SERVER</span>
          <div class="debug-line">
            <b class="dv">{{ roomState.self?.rtmpServer }}</b>
            <CopyButton variant="debug" :text="roomState.self?.rtmpServer ?? ''" title="复制服务器地址" />
          </div>
        </div>
        <div class="debug-row">
          <span class="dk">串流密钥 · STREAM KEY</span>
          <div class="debug-line">
            <b class="dv">{{ roomState.self?.streamKey }}</b>
            <CopyButton variant="debug" :text="roomState.self?.streamKey ?? ''" title="复制串流密钥" />
          </div>
        </div>

        <div class="debug-sep"></div>
        <div class="debug-row inline">
          <span class="dk">推流状态 · STREAM</span>
          <b class="dv" :style="{ color: selfLive ? 'var(--mint)' : undefined }">{{ selfLive ? '● 直播中' : status === 'error' ? '● 重连中' : '○ 未推流' }}{{ latency ? ` · ${latency}ms` : '' }}</b>
        </div>
        <div class="debug-row inline">
          <span class="dk">画面状态 · VIDEO</span>
          <b class="dv" :style="{ color: videoState.ok ? 'var(--mint)' : 'var(--live)' }">{{ videoState.text }}</b>
        </div>
        <div class="debug-row inline">
          <span class="dk">流媒体 · MEDIA</span>
          <b class="dv" :style="{ color: roomState.srsOnline ? 'var(--mint)' : 'var(--live)' }">{{ roomState.srsOnline ? '● 已连接' : '○ 不可达' }}</b>
        </div>
        <div class="debug-row">
          <span class="dk">OBS 填写方式 · HOW TO</span>
          <span class="dk" style="white-space:normal;line-height:1.6;color:var(--text);font-weight:500">OBS → 设置 → 推流 → 服务选择「自定义…」→ 依次填入服务器与串流密钥 → 开始推流</span>
        </div>
      </div>
    </div>

    <div class="feed-foot">
      <span class="js-timer">{{ clock }}</span>
      <span class="self-status">
        <template v-if="selfLive">OBS 推流 <b>正常</b> · {{ footDetail }} · {{ bitrate }} · 队友可见</template>
        <template v-else>采集 <b class="off">未开始</b> · 等待 OBS 推流</template>
      </span>
    </div>
  </article>
</template>
