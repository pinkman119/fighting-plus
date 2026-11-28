<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoom, roomState } from '@/stores/room';
import type { Orientation } from '../../../../packages/shared/protocol';
import { enterBattle, exitBattle, toggleDebugMode, toggleTheme, ui } from '@/stores/ui';

const { onlineCount, maxMembers, selfLive, leave } = useRoom();

const sessionText = computed(() => {
  if (roomState.connected) return '● 已连接';
  return '● 连接中';
});

const modeHint = computed(() => (ui.debugMode ? ' · DEBUG OBS 画面' : ''));

function onBattleClick(e: Event): void {
  e.stopPropagation();
  if (ui.battleActive) return;
  ui.orientPickerOpen = !ui.orientPickerOpen;
}

function onPick(orientation: Orientation): void {
  enterBattle(orientation);
}

function onDocClick(e: MouseEvent): void {
  if (!ui.orientPickerOpen) return;
  const target = e.target as HTMLElement;
  if (!target.closest('.orient-picker') && !target.closest('.battle-btn')) ui.orientPickerOpen = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.battleActive) exitBattle();
}

async function onLeave(): Promise<void> {
  await leave();
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <header class="app-head">
    <div class="session">
      <div class="session-title">战术链路 · <span id="roomLabel">{{ roomState.room?.code }}</span></div>
      <div class="session-meta">SESSION <b :class="{ offline: !roomState.connected }">{{ sessionText }}</b> · {{ onlineCount }}/{{ maxMembers }} 在线<span id="modeHint">{{ modeHint }}</span></div>
    </div>
    <div class="crew" aria-label="队员状态">
      <button
        class="crew-chip self debug-btn"
        :class="{ live: selfLive, active: ui.debugMode }"
        :aria-pressed="ui.debugMode"
        aria-label="调试：查看自己的画面"
        title="调试：查看自己的画面"
        @click="toggleDebugMode"
      >
        <svg viewBox="0 0 16 16"><path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3"/><circle cx="8" cy="8" r="2"/></svg>
        <span class="who">{{ roomState.self?.callsign }}</span><span>调试</span>
      </button>
      <button
        class="crew-chip battle-btn"
        :class="{ active: ui.battleActive }"
        :aria-pressed="ui.battleActive"
        aria-label="进入作战视图"
        title="进入作战视图"
        @click="onBattleClick"
      >
        <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>
        <span>作战</span>
      </button>
      <div v-show="ui.orientPickerOpen" class="orient-picker">
        <div class="orient-title">选择画面排列 · 进入后不可更改</div>
        <button type="button" class="orient-opt" :class="{ active: ui.orientation === 'landscape' }" :aria-pressed="ui.orientation === 'landscape'" @click="onPick('landscape')">
          <svg viewBox="0 0 26 26"><rect x="2" y="4" width="10" height="18" rx="1.5"/><rect x="14" y="4" width="10" height="18" rx="1.5"/></svg>
          <span><b>横屏并列</b><em>左右各占一半</em></span>
        </button>
        <button type="button" class="orient-opt" :class="{ active: ui.orientation === 'portrait' }" :aria-pressed="ui.orientation === 'portrait'" @click="onPick('portrait')">
          <svg viewBox="0 0 26 26"><rect x="4" y="2" width="18" height="10" rx="1.5"/><rect x="4" y="14" width="18" height="10" rx="1.5"/></svg>
          <span><b>竖屏并列</b><em>上下各占一半</em></span>
        </button>
      </div>
    </div>
    <div class="room-badge" title="当前房间"><i></i><span>{{ roomState.room?.code }}</span></div>
    <button class="icon-btn" aria-label="切换主题" title="切换明暗主题" @click="toggleTheme">
      <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4"/></svg>
    </button>
    <button class="icon-btn leave-btn" aria-label="离开房间返回大厅" title="离开房间" @click="onLeave">
      <svg viewBox="0 0 20 20"><path d="M8 4H4v12h4M12 6l4 4-4 4M8 10h8"/></svg>
    </button>
  </header>
</template>
