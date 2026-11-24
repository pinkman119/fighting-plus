<script setup lang="ts">
import { ref } from 'vue'
import type { ToolId } from './TacticalCanvas.vue'

const tool = defineModel<ToolId>('tool', { default: 'pan' })
const zoneShape = defineModel<'rect' | 'circle'>('zoneShape', { default: 'rect' })
const pinNote = defineModel<string>('pinNote', { default: '' })

const tools: { id: ToolId; label: string; title: string }[] = [
  { id: 'pan', label: '移动', title: '拖动/缩放地图' },
  { id: 'pin', label: '敌标', title: '点击标记敌人位置' },
  { id: 'arrow', label: '箭头', title: '拖拽绘制进攻/撤退方向' },
  { id: 'eraser', label: '橡皮', title: '点击删除标注' }
]

const showClearConfirm = defineModel<boolean>('showClearConfirm', { default: false })
const mapFileInput = ref<HTMLInputElement | null>(null)

const emit = defineEmits<{
  (e: 'upload-map', file: File): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'clear'): void
}>()

function onPickMap(): void {
  mapFileInput.value?.click()
}

function onMapChange(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    // 预校验：类型白名单 + ≤10MB（任务 4.1）
    const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    if (!okType) {
      alert('仅支持 jpg / png / webp')
    } else if (file.size > 10 * 1024 * 1024) {
      alert('图片不能超过 10MB')
    } else {
      emit('upload-map', file)
    }
    input.value = ''
  }
}
</script>

<template>
  <div class="toolbar">
    <div class="tool-group">
      <button
        v-for="t in tools"
        :key="t.id"
        :class="{ active: tool === t.id }"
        :title="t.title"
        @click="tool = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="tool === 'pin'" class="tool-group">
      <input v-model="pinNote" class="note-input" placeholder="备注（如数量/兵种）" maxlength="20" />
    </div>

    <div v-if="tool === 'zone'" class="tool-group">
      <select v-model="zoneShape">
        <option value="rect">矩形</option>
        <option value="circle">圆形</option>
      </select>
    </div>

    <div class="tool-group">
      <button title="撤销 (Ctrl+Z)" @click="$emit('undo')">撤销</button>
      <button title="重做 (Ctrl+Y)" @click="$emit('redo')">重做</button>
      <button class="danger" title="清空全部标注" @click="showClearConfirm = true">清空</button>
    </div>

    <div class="tool-group spacer-right">
      <button class="primary" @click="onPickMap">上传地图</button>
      <input ref="mapFileInput" type="file" accept=".jpg,.jpeg,.png,.webp" style="display: none" @change="onMapChange" />
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}
.tool-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool-group.spacer-right {
  margin-left: auto;
}
.toolbar button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.note-input {
  width: 160px;
}
</style>
