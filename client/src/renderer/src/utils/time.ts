import type { Annotation } from '@shared/types'

/**
 * 标记时效（任务 4.9）：
 * - 0~30s：完全不透明
 * - - 30s~5min：线性衰减到 0.3
 * - >5min：保持 0.3，不自动删除
 */
export function ageOpacity(createdAt: number, now: number): number {
  const ageSec = Math.max(0, (now - createdAt) / 1000)
  if (ageSec <= 30) return 1
  if (ageSec >= 300) return 0.3
  return 1 - (ageSec - 30) * 0.7 / (300 - 30)
}

/** "X秒前" 标签 */
export function ageLabel(createdAt: number, now: number): string {
  const ageSec = Math.floor(Math.max(0, (now - createdAt) / 1000))
  if (ageSec < 60) return `${ageSec}秒前`
  const min = Math.floor(ageSec / 60)
  if (min < 60) return `${min}分${ageSec % 60}秒前`
  return `${Math.floor(min / 60)}小时前`
}

/** 按类型归类渲染配置辅助 */
export function sortAnnotations(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => a.createdAt - b.createdAt)
}
