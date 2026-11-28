<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import AppHead from '@/components/AppHead.vue';
import BattleView from '@/components/BattleView.vue';
import ControlBar from '@/components/ControlBar.vue';
import Feeds from '@/components/Feeds.vue';
import Lobby from '@/components/Lobby.vue';
import TitleBar from '@/components/TitleBar.vue';
import { isDesktop } from '@/platform';
import { useRoom, roomState } from '@/stores/room';
import { ui } from '@/stores/ui';

const room = useRoom();
const inRoom = computed(() => roomState.phase === 'in-room');

onMounted(() => {
  void room.restoreSession();
  room.startHealthPoll();
});

onBeforeUnmount(() => room.stopHealthPoll());
</script>

<template>
  <TitleBar v-if="isDesktop" />
  <div class="app" :class="{ 'debug-mode': ui.debugMode }">
    <BattleView />
    <Lobby v-if="!inRoom" />
    <template v-else>
      <AppHead />
      <div class="app-body">
        <Teleport to="#battle-stage" :disabled="!ui.battleActive">
          <Feeds />
        </Teleport>
      </div>
      <ControlBar />
    </template>
    <div class="toast" :class="{ show: ui.toastVisible }" role="status" aria-live="polite">{{ ui.toast }}</div>
  </div>
</template>
