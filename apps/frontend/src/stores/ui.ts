import { reactive, watch } from 'vue';
import type { Orientation } from '../../../../packages/shared/protocol';

export interface UiState {
  theme: 'dark' | 'light';
  /** 调试模式：仅显示自己的画面 */
  debugMode: boolean;
  battleActive: boolean;
  /** 作战视图画面排列（进入后不可更改） */
  orientation: Orientation;
  orientPickerOpen: boolean;
  /** 单画面全屏的成员 id */
  soloId: string | null;
  /** 聚焦的成员 id */
  focusId: string | null;
  toast: string;
  toastVisible: boolean;
  toastKind: 'info' | 'error';
}

const STORAGE_THEME = 'fighting-plus.theme.v1';

function loadTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem(STORAGE_THEME) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export const ui = reactive<UiState>({
  theme: loadTheme(),
  debugMode: false,
  battleActive: false,
  orientation: 'landscape',
  orientPickerOpen: false,
  soloId: null,
  focusId: null,
  toast: '',
  toastVisible: false,
  toastKind: 'info',
});

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#e9e7df' : '#0e0f0d');
}

watch(() => ui.theme, (theme) => {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_THEME, theme);
  } catch {
    /* ignore */
  }
});
applyTheme(ui.theme);

export function toggleTheme(): void {
  ui.theme = ui.theme === 'light' ? 'dark' : 'light';
}

export function toggleDebugMode(): void {
  setDebugMode(!ui.debugMode);
}

export function setDebugMode(on: boolean): void {
  if (on && ui.battleActive) exitBattle();
  ui.debugMode = on;
  ui.focusId = null;
  ui.orientPickerOpen = false;
}

export function enterBattle(orientation: Orientation): void {
  ui.debugMode = false;
  ui.focusId = null;
  ui.orientation = orientation;
  ui.orientPickerOpen = false;
  ui.soloId = null;
  ui.battleActive = true;
}

export function exitBattle(): void {
  ui.battleActive = false;
  ui.soloId = null;
}

export function toggleSolo(memberId: string): void {
  ui.soloId = ui.soloId === memberId ? null : memberId;
}

export function toggleFocus(memberId: string): void {
  ui.focusId = ui.focusId === memberId ? null : memberId;
}

/** 离开房间时复位所有房间内视图状态 */
export function resetRoomView(): void {
  exitBattle();
  ui.debugMode = false;
  ui.focusId = null;
  ui.orientPickerOpen = false;
}

let toastTimer: number | undefined;

export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  ui.toast = message;
  ui.toastVisible = true;
  ui.toastKind = kind;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toastVisible = false;
  }, kind === 'error' ? 3200 : 1800);
}
