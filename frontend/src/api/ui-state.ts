import { readJsonState, removeJsonState, UI_STATE_KEY, writeJsonState } from '@/data/local-store'

// 页面偏好（如井盖页的筛选条件）：刷新或重新进入页面时自动恢复。
function scopedKey(key: string): string {
  return `${UI_STATE_KEY}:${key}`
}

export function loadUiState<T>(key: string, fallback: T): T {
  return readJsonState(scopedKey(key), fallback)
}

export function saveUiState<T>(key: string, value: T): void {
  try {
    writeJsonState(scopedKey(key), value)
  } catch {
    // 配额满或隐私模式下静默降级：仅本次会话内不保留偏好。
  }
}

export function clearUiState(key: string): void {
  try {
    removeJsonState(scopedKey(key))
  } catch {
    // 忽略：无 localStorage 时本就没有持久偏好。
  }
}
