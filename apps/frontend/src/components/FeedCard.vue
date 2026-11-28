<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MemberDto } from '../../../../packages/shared/protocol';
import { fmtBitrate, fmtClock, fmtCodec, uid } from '@/lib/format';
import { useTicker } from '@/composables/useTicker';
import { useVideoMetrics } from '@/composables/useVideoMetrics';
import { useStreamPlayer } from '@/composables/useStreamPlayer';
import { useRoom, roomState } from '@/stores/room';
import { exitBattle, toggleFocus, toggleSolo, ui } from '@/stores/ui';

const props = defineProps<{ member: MemberDto }>();

const { sendMarker } = useRoom();
const { now } = useTicker();

const videoEl = ref<HTMLVideoElement | null>(null);
const { metrics } = useVideoMetrics(videoEl);

const live = computed(() => props.member.stream.online);
const { status, latency } = useStreamPlayer(
  videoEl,
  () => live.value,
  () => props.member.playToken,
);

const localPings = ref<{ id: string; x: number; y: number }[]>([]);

const focused = computed(() => ui.focusId === props.member.id);
const remoteMarkers = computed(() => roomState.markers.filter((m) => m.memberId === props.member.id));

const clock = computed(() => {
  const since = props.member.stream.onlineSince;
  if (!live.value || !since) return '00:00:00';
  return fmtClock((now.value * 1000 - since) / 1000);
});

const bitrate = computed(() => fmtBitrate(props.member.stream.bitrateKbps));

const hudTl = computed(() => {
  const codec = fmtCodec(props.member.stream.videoCodec);
  const w = metrics.value.width;
  const h = metrics.value.height;
  return w && h ? `LIVE · ${codec} · ${w}×${h}` : `LIVE · ${codec}`;
});

const hudBr = computed(() => `SYNC ${metrics.value.fps ?? '--'}FPS`);

function callsignOf(id: string): string {
  return roomState.room?.members.find((m) => m.id === id)?.callsign ?? '?';
}

function onScreenClick(e: MouseEvent): void {
  if (ui.battleActive) {
    toggleSolo(props.member.id);
    return;
  }
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  const id = uid();
  localPings.value.push({ id, x, y });
  window.setTimeout(() => {
    localPings.value = localPings.value.filter((p) => p.id !== id);
  }, 1100);
  sendMarker(props.member.id, x, y);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}
</script>

<template>
  <article
    class="feed"
    :class="{ 'is-focused': focused, 'is-solo': ui.battleActive && ui.soloId === member.id }"
  >
    <div class="feed-head">
      <div class="peer">
        <span class="peer-id">{{ member.callsign }}</span>
        <span class="peer-name">{{ member.nickname }} · {{ member.feedLabel }}</span>
        <span v-if="member.online" class="peer-online"><i></i><em>在线</em></span>
        <span v-else class="peer-offline">离线</span>
      </div>
      <div class="feed-tools">
        <span v-if="live" class="live-tag">LIVE</span>
        <button data-focus title="聚焦画面" :aria-label="`聚焦队友 ${member.callsign} 的画面`" :class="{ on: focused }" @click="toggleFocus(member.id)">
          <svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
        </button>
        <button class="battle-solo-btn" data-solo title="单画面全屏" :aria-label="`队友 ${member.callsign} 画面单画面全屏`" @click="toggleSolo(member.id)">
          <svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
        </button>
        <button class="battle-quit-btn" data-quit title="退出作战" aria-label="退出作战" @click="exitBattle()">
          <svg viewBox="0 0 20 20"><path d="M8 4H4v12h4M12 6l4 4-4 4M8 10h8"/></svg><span>退出</span>
        </button>
      </div>
    </div>

    <div class="screen" data-screen @click="onScreenClick">
      <video
        ref="videoEl"
        v-show="live"
        class="stream-video"
        muted
        autoplay
        playsinline
        @playing="status = 'playing'"
        @waiting="status = 'connecting'"
      ></video>

      <div v-if="!live" class="no-signal">
        <div class="ns-id">{{ member.callsign }}</div>
        <div class="ns-title">NO SIGNAL · 等待推流</div>
        <div class="ns-hint"><b>{{ member.nickname }}</b> 尚未开始 OBS 推流{{ member.online ? '' : '（当前离线）' }}</div>
      </div>
      <div v-else-if="status === 'error'" class="no-signal">
        <div class="ns-id">{{ member.callsign }}</div>
        <div class="ns-title">SIGNAL LOST · 正在重连</div>
        <div class="ns-hint"><b>{{ member.nickname }}</b> 的画面暂时中断，正在自动恢复</div>
      </div>

      <span v-for="p in localPings" :key="p.id" class="ping" :style="{ left: pct(p.x), top: pct(p.y) }"></span>
      <span
        v-for="m in remoteMarkers"
        :key="m.id"
        class="ping remote"
        :style="{ left: pct(m.x), top: pct(m.y) }"
        :data-label="`${callsignOf(m.from)}${m.label ? ' · ' + m.label : ''}`"
      ></span>

      <template v-if="live">
        <span class="hud-line tl">{{ hudTl }}</span>
        <span class="hud-line br">{{ hudBr }}</span>
      </template>
    </div>

    <div class="feed-foot">
      <span class="js-timer">{{ clock }}</span>
      <span>码率 <strong>{{ bitrate }}</strong> · 延迟 <span class="lat">{{ latency ?? '--' }}ms</span></span>
    </div>
  </article>
</template>
