import { SEED_ROWS } from './seed'
import type { EntryRow, ManholeWorkspace } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'
// 井盖养护工作区（批次、更换轨迹、页面状态）单独一键，和业务条目分开存放。
const MANHOLE_KEY = 'underground-pipeline-inspection:manhole-workspace'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function emptyWorkspace(): ManholeWorkspace {
  return { batches: [], tracks: [], filters: {}, activeBatchId: null }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
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
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

let workspaceCache: ManholeWorkspace | null = null

function readWorkspace(): ManholeWorkspace {
  if (workspaceCache !== null) {
    return workspaceCache
  }
  const fallback = emptyWorkspace()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(MANHOLE_KEY)
  if (!raw) {
    workspaceCache = fallback
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ManholeWorkspace>
    workspaceCache = {
      batches: Array.isArray(parsed.batches) ? (parsed.batches as ManholeWorkspace['batches']) : [],
      tracks: Array.isArray(parsed.tracks) ? (parsed.tracks as ManholeWorkspace['tracks']) : [],
      filters: parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {},
      activeBatchId: typeof parsed.activeBatchId === 'string' ? parsed.activeBatchId : null,
    }
    return workspaceCache
  } catch {
    workspaceCache = fallback
    return fallback
  }
}

export function getWorkspace(): ManholeWorkspace {
  return readWorkspace()
}

export function saveWorkspace(workspace: ManholeWorkspace): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MANHOLE_KEY, JSON.stringify(workspace))
  }
  workspaceCache = workspace
}

// 原子提交：井盖条目（entries 键）与养护工作区（manhole 键）必须一起生效。
// 先写完两个键再更新内存缓存；第二个键写失败时回滚第一个键，任何时候读到的两侧数据都一致。
// 两个 __fail* 哨兵键仅供验证脚本注入写入故障，正常运行时不会存在。
export function commitEntriesAndWorkspace(
  entries: Record<string, EntryRow[]>,
  workspace: ManholeWorkspace,
): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = entries
    workspaceCache = workspace
    return
  }
  const entriesText = JSON.stringify(entries)
  const workspaceText = JSON.stringify(workspace)
  if (window.localStorage.getItem('__fail:entries')) {
    throw new Error('注入故障：条目键写入失败')
  }
  const rollbackEntries = window.localStorage.getItem(STORAGE_KEY)
  window.localStorage.setItem(STORAGE_KEY, entriesText)
  try {
    if (window.localStorage.getItem('__fail:workspace')) {
      throw new Error('注入故障：工作区键写入失败')
    }
    window.localStorage.setItem(MANHOLE_KEY, workspaceText)
  } catch (error) {
    if (rollbackEntries === null) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, rollbackEntries)
    }
    throw error
  }
  cache = entries
  workspaceCache = workspace
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function manholeStorageKey(): string {
  return MANHOLE_KEY
}
