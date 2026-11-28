<script setup lang="ts">
import { computed } from 'vue';
import { fmtCodec, netLabel } from '@/lib/format';
import { useRoom, roomState } from '@/stores/room';
import { setDebugMode, showToast, ui } from '@/stores/ui';

const { selfMember, selfLive, peers, stopStream } = useRoom();

const stateText = computed(() => {
  if (!selfLive.value) return '未开播 · 画面未同步';
  const names = peers.value.filter((p) => p.online).map((p) => p.callsign);
  return names.length ? `直播中 · 已同步给 ${names.join(' / ')}` : '直播中 · 等待队友加入';
});

const codecText = computed(() => fmtCodec(selfMember.value?.stream.videoCodec));

const netWarn = computed(() => {
  const rtt = roomState.rtt;
  return rtt == null || rtt >= 300;
});

function onStream(): void {
  if (selfLive.value) {
    stopStream();
    showToast('已请求停止推流，OBS 将断开连接');
    return;
  }
  setDebugMode(true);
  showToast('在调试面板查看 OBS 画面并复制推流信息');
}

function onLayout(): void {
  if (ui.focusId) {
    ui.focusId = null;
    return;
  }
  const first = peers.value[0];
  if (first) ui.focusId = first.id;
}
</script>

<template>
  <footer class="control">
    <div class="self-card">
      <div class="self-av">{{ roomState.self?.callsign }}</div>
      <div class="self-info"><b>你的画面</b><span id="selfState">{{ stateText }}</span></div>
    </div>
    <button class="btn-stream" :class="{ 'is-live': selfLive }" :aria-pressed="selfLive" @click="onStream">
      <i></i><span id="streamLabel">{{ selfLive ? '停止战术直播' : '开启战术直播' }}</span>
    </button>
    <div class="ctrl-group">
      <button class="icon-btn layout-btn" :class="{ on: Boolean(ui.focusId) }" aria-label="切换画面布局" title="切换布局" @click="onLayout">
        <svg viewBox="0 0 20 20"><rect x="2" y="3" width="7" height="14" rx="1"/><rect x="11" y="3" width="7" height="6" rx="1"/><rect x="11" y="11" width="7" height="6" rx="1"/></svg>
      </button>
    </div>
    <span class="net" :title="selfLive ? `视频编码 ${codecText}` : undefined">网络 <b :class="{ warn: netWarn }">{{ netLabel(roomState.rtt) }}</b> · {{ roomState.rtt ?? '--' }}ms</span>
  </footer>
</template>
