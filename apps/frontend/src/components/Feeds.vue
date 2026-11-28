<script setup lang="ts">
import { useRoom, roomState } from '@/stores/room';
import { ui } from '@/stores/ui';
import DebugFeed from '@/components/DebugFeed.vue';
import FeedCard from '@/components/FeedCard.vue';

const { peers } = useRoom();
</script>

<template>
  <section
    class="feeds"
    :class="{ focused: Boolean(ui.focusId), 'is-empty': peers.length === 0 && !ui.debugMode }"
    aria-label="队友实时画面"
  >
    <DebugFeed v-if="ui.debugMode" />
    <div v-else-if="peers.length === 0" class="feeds-empty">
      <div class="fe-kicker">CHANNEL READY · 等待队员推流</div>
      <div class="fe-title">等待队友加入</div>
      <div class="fe-sub">把房间码 <code>{{ roomState.room?.code }}</code> 发给队友，队友输入房间码后即可进入链路</div>
    </div>
    <FeedCard v-for="m in peers" :key="m.id" :member="m" />
  </section>
</template>
