<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { RoomJoinResponse } from '../../../../packages/shared/protocol';
import { ApiError } from '@/api/http';
import { APP_VERSION, desktop, isDesktop } from '@/platform';
import { useRoom, roomState } from '@/stores/room';
import { showToast } from '@/stores/ui';
import CopyButton from '@/components/CopyButton.vue';

type Stage = 'home' | 'created' | 'join';

const room = useRoom();

const stage = ref<Stage>('home');
const busy = ref(false);
const created = ref<RoomJoinResponse | null>(null);
const joinInput = ref('');
const joinErr = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

const sysMain = computed(() => {
  if (roomState.serverOk === null) return 'SYSTEM CHECK';
  return roomState.serverOk ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE';
});
const sysSub = computed(() => {
  if (roomState.serverOk === null) return '正在检测服务端';
  if (!roomState.serverOk) return '无法连接服务器';
  return roomState.srsOnline ? '流媒体已就绪 · 战术链路待建立' : '战术链路待建立';
});
/** 桌面客户端在离线时允许重新配置服务端地址 */
const canConfigure = computed(() => isDesktop && roomState.serverOk === false);

async function onCreate(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    created.value = await room.createRoom();
    stage.value = 'created';
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : '创建房间失败', 'error');
  } finally {
    busy.value = false;
  }
}

function onJoinClick(): void {
  joinInput.value = '';
  joinErr.value = '';
  stage.value = 'join';
  void nextTick(() => inputEl.value?.focus());
}

async function onCreatedBack(): Promise<void> {
  const res = created.value;
  created.value = null;
  stage.value = 'home';
  if (res) await room.abandonCreated(res);
}

function onJoinBack(): void {
  stage.value = 'home';
  joinErr.value = '';
}

function onEnterRoom(): void {
  const res = created.value;
  if (!res) return;
  created.value = null;
  room.enterRoom(res);
}

async function submitJoin(): Promise<void> {
  const code = joinInput.value.trim().toUpperCase();
  if (code.length < 4) {
    joinErr.value = '房间码至少需要 4 位字符';
    inputEl.value?.focus();
    return;
  }
  joinErr.value = '';
  busy.value = true;
  try {
    await room.joinRoom(code);
  } catch (err) {
    joinErr.value = err instanceof ApiError ? err.message : '加入房间失败';
    inputEl.value?.focus();
  } finally {
    busy.value = false;
  }
}

async function configureServer(): Promise<void> {
  if (!desktop) return;
  const current = await desktop.config.getServerUrl();
  const input = window.prompt('请输入 fighting-plus 服务端地址', current);
  if (input === null) return;
  const url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[\w.-]+(:\d+)?$/i.test(url)) {
    showToast('服务端地址格式不正确，例如 http://192.168.1.10:3118', 'error');
    return;
  }
  await desktop.config.setServerUrl(url);
  desktop.config.reload();
}
</script>

<template>
  <div class="lobby" :data-stage="stage">
    <div class="lobby-bar">
      <component
        :is="canConfigure ? 'button' : 'div'"
        class="lobby-sys"
        :class="{ off: roomState.serverOk === false }"
        :title="canConfigure ? '点击配置服务端地址' : undefined"
        @click="canConfigure && configureServer()"
      >
        <i></i>{{ sysMain }}<span>·</span>{{ sysSub }}
      </component>
      <div class="lobby-ver">v{{ APP_VERSION }} / SECURE LINK</div>
    </div>

    <div class="lobby-main">
      <div class="hero-block">
        <div class="lobby-emblem">
          <span class="tick"></span><span class="tick t2"></span><span class="tick t3"></span><span class="tick t4"></span>
          <span class="ring"></span><span class="core"></span>
        </div>
        <div class="lobby-copy">
          <div class="lobby-kicker">TACTICAL LINK · INITIALIZE</div>
          <h1 class="lobby-title">建立<em>战术链路</em></h1>
          <p class="lobby-sub">三人小队实时画面共享 · 战场信息同步 · 一键进入作战协同</p>
        </div>
      </div>

      <div class="stage-home lobby-actions">
        <button class="lobby-btn primary" :disabled="busy" @click="onCreate">
          <span class="lb-ico"><svg viewBox="0 0 20 20"><path d="M10 3v14M3 10h14"/></svg></span>
          <span class="lb-txt"><b>创建房间</b><em>生成 OBS 推流码，开启新链路</em></span>
          <span class="lb-arr">→</span>
        </button>
        <button class="lobby-btn" @click="onJoinClick">
          <span class="lb-ico"><svg viewBox="0 0 20 20"><path d="M8 3H4v14h4M12 6l4 4-4 4M8 10h8"/></svg></span>
          <span class="lb-txt"><b>加入房间</b><em>输入房间码，进入队友链路</em></span>
          <span class="lb-arr">→</span>
        </button>
      </div>

      <div v-if="created" class="stage-created">
        <div class="stage-card">
          <div class="created-head">
            <span class="created-check"><svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg></span>
            <div><b>房间已建立</b><em>CHANNEL READY · 等待队员推流</em></div>
          </div>
          <div class="room-code-wrap">
            <div class="room-code-label">ROOM CODE · 房间码</div>
            <div class="room-code">{{ created.room.code }}</div>
          </div>
          <div class="cred-list">
            <div class="cred">
              <div class="cred-info"><span>OBS 服务器 · SERVER</span><b>{{ created.self.rtmpServer }}</b></div>
              <CopyButton :text="created.self.rtmpServer" />
            </div>
            <div class="cred">
              <div class="cred-info"><span>串流密钥 · STREAM KEY</span><b>{{ created.self.streamKey }}</b></div>
              <CopyButton :text="created.self.streamKey" />
            </div>
          </div>
          <div class="obs-note"><i>▲</i><span>将服务器与串流密钥填入 OBS「设置 → 推流」，开始推流后队友即可看到你的画面。</span></div>
        </div>
        <div class="lobby-cta">
          <button class="btn-back" @click="onCreatedBack">返回</button>
          <button class="btn-enter" @click="onEnterRoom">进入房间 →</button>
        </div>
      </div>

      <div class="stage-join">
        <div class="stage-card">
          <div class="created-head">
            <span class="created-check" style="background:var(--amber-soft);color:var(--amber)"><svg viewBox="0 0 20 20"><path d="M8 3H4v14h4M12 6l4 4-4 4M8 10h8"/></svg></span>
            <div><b>加入战术链路</b><em>ENTER ROOM CODE</em></div>
          </div>
          <form class="join-field" style="margin-top:18px" @submit.prevent="submitJoin">
            <label for="joinInput">输入 8 位房间码</label>
            <input
              id="joinInput"
              ref="inputEl"
              v-model="joinInput"
              maxlength="12"
              autocomplete="off"
              spellcheck="false"
              placeholder="FP-A7K2M9"
              @input="joinErr = ''"
            >
            <div class="join-err">{{ joinErr }}</div>
          </form>
        </div>
        <div class="lobby-cta">
          <button class="btn-back" @click="onJoinBack">返回</button>
          <button class="btn-enter" :disabled="busy" @click="submitJoin">加入房间 →</button>
        </div>
      </div>
    </div>

    <div class="lobby-foot"><span>▲ 需要有 OBS 推流设备</span><span>ENCRYPTED · P2P RELAY</span></div>
  </div>
</template>
