<script setup lang="ts">
import { ui } from '@/stores/ui';

/**
 * 作战视图容器：Feeds 通过 Teleport 移动到 #battle-stage，
 * 视频播放器实例保持不变。
 */
</script>

<template>
  <div
    class="battle-view"
    :class="[ui.orientation, { solo: Boolean(ui.soloId) }]"
    :hidden="!ui.battleActive"
    role="dialog"
    aria-label="作战视图"
  >
    <div class="battle-stage" id="battle-stage"></div>
  </div>
</template>
