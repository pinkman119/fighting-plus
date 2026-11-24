<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Konva } from 'konva'
import type { Annotation, MapInfo, PinPayload, ArrowPayload, ZonePayload } from '@shared/types'
import { ageLabel, ageOpacity } from '@/utils/time'

export type ToolId = 'pan' | 'pin' | 'arrow' | 'eraser'

const props = withDefaults(
  defineProps<{
    annotations: Annotation[]
    map: MapInfo | null
    readonly?: boolean
    tool?: ToolId
    /** 点标记的文字备注（创建时携带） */
    pinNote?: string
    /** 区域形状 */
    zoneShape?: 'rect' | 'circle'
  }>(),
  {
    readonly: false,
    tool: 'pan',
    pinNote: '',
    zoneShape: 'rect'
  }
)

const emit = defineEmits<{
  (e: 'add', type: 'pin' | 'arrow' | 'zone', payload: unknown): void
  (e: 'remove', id: string): void
}>()

const container = ref<HTMLDivElement | null>(null)
const stageRef = ref<{ getStage(): Konva.Stage } | null>(null)
const size = ref({ width: 800, height: 600 })

// ---------- 时间跳动（标记时效渲染，任务 4.9） ----------
const now = ref(Date.now())
let ticker: number | undefined

// ---------- 视图（缩放/平移，仅本地，任务 4.2） ----------
const scale = ref(1)
const pos = ref({ x: 0, y: 0 })

// ---------- 绘制交互 ----------
type DragState =
  | { kind: 'pin'; x1: number; y1: number }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'zone'; x1: number; y1: number; x2: number; y2: number }
  | null
const drag = ref<DragState>(null)

// ---------- 地图位图 ----------
const mapImage = shallowRef<HTMLImageElement | null>(null)
watch(
  () => props.map,
  (m) => {
    if (!m) {
      mapImage.value = null
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      mapImage.value = img
    }
    img.src = m.url
  },
  { immediate: true }
)

onMounted(() => {
  ticker = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
  const el = container.value
  if (el) {
    const ro = new ResizeObserver(() => {
      size.value = { width: el.clientWidth, height: el.clientHeight }
    })
    ro.observe(el)
    size.value = { width: el.clientWidth, height: el.clientHeight }
  }
})
onBeforeUnmount(() => {
  if (ticker) window.clearInterval(ticker)
})

const stageConfig = computed(() => ({
  width: size.value.width,
  height: size.value.height,
  scaleX: scale.value,
  scaleY: scale.value,
  x: pos.value.x,
  y: pos.value.y,
  draggable: props.tool === 'pan' && !props.readonly
}))

function relativePointer(): { x: number; y: number } | null {
  const stage = stageRef.value?.getStage()
  if (!stage) return null
  const p = stage.getRelativePointerPosition()
  return p ? { x: p.x, y: p.y } : null
}

// 缩放：以指针为中心，10%–400%
function onWheel(e: WheelEvent): void {
  e.preventDefault?.()
  const stage = stageRef.value?.getStage()
  if (!stage) return
  const pointer = stage.getPointerPosition()
  if (!pointer) return
  const oldScale = scale.value
  const direction = e.deltaY > 0 ? -1 : 1
  const factor = direction > 0 ? 1.08 : 1 / 1.08
  const newScale = Math.min(4, Math.max(0.1, oldScale * factor))
  if (newScale === oldScale) return
  const mousePointTo = {
    x: (pointer.x - pos.value.x) / oldScale,
    y: (pointer.y - pos.value.y) / oldScale
  }
  scale.value = newScale
  pos.value = {
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale
  }
}

function onStageMouseDown(): void {
  if (props.readonly) return
  const p = relativePointer()
  if (!p) return
  if (props.tool === 'arrow') {
    drag.value = { kind: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y }
  } else if (props.tool === 'zone') {
    drag.value = { kind: 'zone', x1: p.x, y1: p.y, x2: p.x, y2: p.y }
  } else if (props.tool === 'pin') {
    drag.value = { kind: 'pin', x1: p.x, y1: p.y }
  }
}

function onStageMouseMove(): void {
  if (!drag.value || drag.value.kind === 'pin') return
  const p = relativePointer()
  if (!p) return
  drag.value = { ...drag.value, x2: p.x, y2: p.y }
}

async function onStageMouseUp(): Promise<void> {
  const d = drag.value
  drag.value = null
  if (!d || props.readonly) return
  const p = relativePointer()
  if (!p) return

  if (d.kind === 'pin') {
    emit('add', 'pin', { x: d.x1, y: d.y1 } satisfies PinPayload)
    return
  }
  const moved = Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
  if (moved < 8) return // 误触忽略

  if (d.kind === 'arrow') {
    emit('add', 'arrow', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 } satisfies ArrowPayload)
  } else if (d.kind === 'zone') {
    const payload: ZonePayload = {
      shape: props.zoneShape,
      x: Math.min(d.x1, d.x2),
      y: Math.min(d.y1, d.y2),
      w: Math.abs(d.x2 - d.x1),
      h: Math.abs(d.y2 - d.y1)
    }
    emit('add', 'zone', payload)
  }
}

function onAnnotationClick(a: Annotation): void {
  if (props.readonly) return
  if (props.tool === 'eraser') {
    emit('remove', a.id)
  }
}

// ---------- 渲染配置 ----------

function pinConfig(a: Annotation) {
  const p = a.payload as PinPayload
  return {
    id: a.id,
    x: p.x,
    y: p.y,
    opacity: ageOpacity(a.createdAt, now.value),
    draggable: false
  }
}

function annotationOpacity(a: Annotation): number {
  return ageOpacity(a.createdAt, now.value)
}

function arrowConfig(a: Annotation) {
  const p = a.payload as ArrowPayload
  return {
    id: a.id,
    points: [p.x1, p.y1, p.x2, p.y2],
    stroke: a.color,
    fill: a.color,
    strokeWidth: 4,
    opacity: ageOpacity(a.createdAt, now.value) * 0.95,
    pointerLength: 16,
    pointerWidth: 14,
    hitStrokeWidth: 16
  }
}

function zoneConfig(a: Annotation) {
  const p = a.payload as ZonePayload
  const common = {
    fill: a.color,
    opacity: ageOpacity(a.createdAt, now.value) * 0.18,
    stroke: a.color,
    strokeWidth: 2,
    hitStrokeWidth: 16,
    listening: true
  }
  if (p.shape === 'rect') {
    return { kind: 'rect', config: { ...common, x: p.x, y: p.y, width: p.w, height: p.h } }
  }
  return {
    kind: 'ellipse',
    config: { ...common, x: p.x + p.w / 2, y: p.y + p.h / 2, radiusX: p.w / 2, radiusY: p.h / 2 }
  }
}

const previewConfig = computed(() => {
  const d = drag.value
  if (!d || d.kind === 'pin') return null
  if (d.kind === 'arrow') {
    return {
      kind: 'arrow' as const,
      config: {
        points: [d.x1, d.y1, d.x2, d.y2],
        stroke: '#ffd166',
        fill: '#ffd166',
        strokeWidth: 4,
        pointerLength: 16,
        pointerWidth: 14,
        opacity: 0.9
      }
    }
  }
  const x = Math.min(d.x1, d.x2)
  const y = Math.min(d.y1, d.y2)
  const w = Math.abs(d.x2 - d.x1)
  const h = Math.abs(d.y2 - d.y1)
  if (props.zoneShape === 'rect') {
    return { kind: 'rect' as const, config: { x, y, width: w, height: h, stroke: '#ffd166', strokeWidth: 2, dash: [6, 4], opacity: 0.9 } }
  }
  return { kind: 'ellipse' as const, config: { x: x + w / 2, y: y + h / 2, radiusX: w / 2, radiusY: h / 2, stroke: '#ffd166', strokeWidth: 2, dash: [6, 4], opacity: 0.9 } }
})
</script>

<template>
  <div ref="container" class="canvas-root" :class="{ 'tool-draw': !readonly && tool !== 'pan', 'tool-eraser': tool === 'eraser' && !readonly }">
    <v-stage ref="stageRef" :config="stageConfig" @mousedown="onStageMouseDown" @mousemove="onStageMouseMove" @mouseup="onStageMouseUp" @wheel="onWheel">
      <v-layer>
        <v-image v-if="mapImage" :config="{ image: mapImage, width: mapImage.naturalWidth, height: mapImage.naturalHeight }" />
      </v-layer>
      <v-layer>
        <template v-for="a in annotations" :key="a.id">
          <!-- 点标记 -->
          <v-group v-if="a.type === 'pin'" :config="pinConfig(a)" @click="onAnnotationClick(a)">
            <v-circle :config="{ radius: 13, fill: a.color, stroke: '#ffffff', strokeWidth: 2 }" />
            <v-text
              v-if="a.note"
              :config="{ text: a.note, x: -30, y: -26, width: 90, align: 'center', fontSize: 13, fontStyle: 'bold', fill: a.color }"
            />
            <v-text
              :config="{ text: ageLabel(a.createdAt, now), x: 15, y: 2, fontSize: 10, fill: '#e2e8f0' }"
            />
          </v-group>
          <!-- 箭头 -->
          <v-arrow v-else-if="a.type === 'arrow'" :config="arrowConfig(a)" @click="onAnnotationClick(a)" />
          <!-- 区域 -->
          <template v-else-if="a.type === 'zone'">
            <v-rect
              v-if="zoneConfig(a).kind === 'rect'"
              :config="zoneConfig(a).config"
              :opacity="annotationOpacity(a) * 0.35"
              @click="onAnnotationClick(a)"
            />
            <v-ellipse v-else :config="zoneConfig(a).config" @click="onAnnotationClick(a)" />
            <v-text
              v-if="a.note"
              :config="{
                text: a.note,
                x: (a.payload as any).x + 4,
                y: (a.payload as any).y + 2,
                fontSize: 11,
                fill: a.color,
                opacity: annotationOpacity(a)
              }"
            />
          </template>
        </template>

        <!-- 绘制预览 -->
        <template v-if="previewConfig">
          <v-arrow v-if="previewConfig.kind === 'arrow'" :config="previewConfig.config" />
          <v-rect v-else-if="previewConfig.kind === 'rect'" :config="previewConfig.config" />
          <v-ellipse v-else :config="previewConfig.config" />
        </template>
      </v-layer>
    </v-stage>

    <div v-if="!map" class="canvas-empty">尚未上传地图 —— 点击工具栏“上传地图”共享给你的小队</div>
  </div>
</template>

<style scoped>
.canvas-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0b0e12;
}
.tool-draw {
  cursor: crosshair;
}
.tool-eraser {
  cursor: cell;
}
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 14px;
  pointer-events: none;
}
</style>
