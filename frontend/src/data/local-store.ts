import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：井盖养护批次功能上线后更新了井盖示例数据，旧缓存里的样例数据会自然作废。
const ENTRIES_KEY = 'underground-pipeline-inspection:entries:v2'

// 业务草稿（养护批次）、页面偏好（筛选条件）、更换轨迹各自独立存储，
// 但可以和业务数据一起走 commitJson 的原子提交，保证井盖与档案不会只写一半。
export const DRAFTS_KEY = 'underground-pipeline-inspection:drafts:v1'
const UI_STATE_KEY = 'underground-pipeline-inspection:ui-state:v1'
const REPLACEMENT_EVENTS_KEY = 'underground-pipeline-inspection:replacement-events:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// localStorage 不可用（隐私模式、SSR 等）时退化到内存，页面刷新内仍然可用。
const memoryFallback = new Map<string, string>()

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function readRaw(key: string): string | null {
  const target = storage()
  if (target) {
    return target.getItem(key)
  }
  return memoryFallback.has(key) ? memoryFallback.get(key)! : null
}

function writeRaw(key: string, value: string): void {
  const target = storage()
  if (target) {
    target.setItem(key, value)
  } else {
    memoryFallback.set(key, value)
  }
}

function removeRaw(key: string): void {
  const target = storage()
  if (target) {
    target.removeItem(key)
  } else {
    memoryFallback.delete(key)
  }
}

function readJson<T>(key: string, fallback: () => T): T {
  const raw = readRaw(key)
  if (raw === null) {
    return fallback()
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback()
  }
}

/**
 * 原子提交多个 localStorage 键：
 * 逐键写入时若有一个失败（如配额超限），已写入的键按顺序回滚，
 * 调用方拿到异常后内存状态不变，不会出现「井盖已更换、档案没更新」的半截数据。
 */
export function commitJson(writes: Record<string, unknown>): void {
  const previous: Array<{ key: string; raw: string | null }> = []
  const keys = Object.keys(writes)
  try {
    for (const key of keys) {
      previous.push({ key, raw: readRaw(key) })
      writeRaw(key, JSON.stringify(writes[key]))
    }
  } catch (error) {
    // 回滚：按写入的逆序恢复旧值，新键则删除。
    for (let i = previous.length - 1; i >= 0; i -= 1) {
      const { key, raw } = previous[i]
      if (raw === null) {
        removeRaw(key)
      } else {
        writeRaw(key, raw)
      }
    }
    throw error
  }
}

export function readJsonState<T>(key: string, fallback: T): T {
  return readJson(key, () => clone(fallback))
}

export function writeJsonState(key: string, value: unknown): void {
  writeRaw(key, JSON.stringify(value))
}

export function removeJsonState(key: string): void {
  removeRaw(key)
}

function readStorage(): Record<string, EntryRow[]> {
  return readJson(ENTRIES_KEY, () => {
    const fallback = clone(SEED_ROWS)
    writeRaw(ENTRIES_KEY, JSON.stringify(fallback))
    return fallback
  })
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  commitJson({ [ENTRIES_KEY]: next })
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export { ENTRIES_KEY, UI_STATE_KEY, REPLACEMENT_EVENTS_KEY }
