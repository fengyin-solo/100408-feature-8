import {
  allRows,
  commitJson,
  DRAFTS_KEY,
  ENTRIES_KEY,
  listRows,
  readJsonState,
  REPLACEMENT_EVENTS_KEY,
} from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 井盖养护批次与更换轨迹：
// 批次草稿、筛选偏好、更换轨迹与井盖/档案业务数据放在不同的 localStorage 键，
// 提交更换时通过 commitJson 一次性原子写入，任何一键失败都会整体回滚。

export type MaintenanceItem = {
  manholeId: number
  addedAt: string
  remark: string
}

export type MaintenanceBatch = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  items: MaintenanceItem[]
}

export type ReplacementEvent = {
  id: number
  manholeId: number
  batchId: string | null
  replacedAt: string
  operator: string
  remark: string
  archiveId: number
}

type DraftsState = { batches: MaintenanceBatch[]; batchSeq: number; eventSeq: number }

const EMPTY_DRAFTS: DraftsState = { batches: [], batchSeq: 0, eventSeq: 0 }
const REPLACED_STATUS = '已更换'
const ARCHIVE_PENDING_STATUS = '待更新'
const ARCHIVE_CATEGORY = '井盖设施'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

// 统一用本地时区的 YYYY-MM-DD HH:mm:ss，方便和「今日」这种按天统计直接比较。
function nowLabel(): string {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function todayLabel(): string {
  return nowLabel().slice(0, 10)
}

function loadDrafts(): DraftsState {
  const parsed = readJsonState<Partial<DraftsState>>(DRAFTS_KEY, EMPTY_DRAFTS)
  return {
    batches: Array.isArray(parsed.batches) ? parsed.batches : [],
    batchSeq: typeof parsed.batchSeq === 'number' ? parsed.batchSeq : 0,
    eventSeq: typeof parsed.eventSeq === 'number' ? parsed.eventSeq : 0,
  }
}

function loadEvents(): ReplacementEvent[] {
  const parsed = readJsonState<{ events: ReplacementEvent[] }>(REPLACEMENT_EVENTS_KEY, {
    events: [],
  })
  return Array.isArray(parsed.events) ? parsed.events : []
}

function manholeMap(): Map<number, EntryRow> {
  const map = new Map<number, EntryRow>()
  for (const row of listRows('manhole')) {
    map.set(Number(row.id), row)
  }
  return map
}

function nextArchiveId(existing: EntryRow[]): number {
  return existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export type BatchGroup = {
  key: string
  road: string
  manholeType: string
  cycle: string
  items: Array<MaintenanceItem & { manhole: EntryRow }>
}

// 新建批次后按「所属道路 + 井盖类型 + 养护周期」三级归组展示。
export function groupBatchItems(items: MaintenanceItem[]): BatchGroup[] {
  const lookup = manholeMap()
  const groups = new Map<string, BatchGroup>()
  for (const item of items) {
    const manhole = lookup.get(item.manholeId)
    if (!manhole) {
      continue
    }
    const road = String(manhole['所属道路'] ?? '未填写道路')
    const manholeType = String(manhole['井盖类型'] ?? '未填写类型')
    const cycle = String(manhole['养护周期'] ?? '未填写周期')
    const key = `${road} / ${manholeType} / ${cycle}`
    const group = groups.get(key)
    if (group) {
      group.items.push({ ...item, manhole })
    } else {
      groups.set(key, { key, road, manholeType, cycle, items: [{ ...item, manhole }] })
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'))
}

export function listBatches(): MaintenanceBatch[] {
  return loadDrafts().batches
}

// 未提交的草稿批次：暂存离开、刷新或重新进入后还能继续。
export function findDraftBatch(): MaintenanceBatch | null {
  const batch = loadDrafts().batches.find((item) => item.submittedAt === null)
  return batch ?? null
}

export function createBatch(name?: string): MaintenanceBatch {
  const drafts = loadDrafts()
  if (drafts.batches.some((batch) => batch.submittedAt === null)) {
    throw new Error('已有一个暂存中的养护批次，请先继续或清空后再新建')
  }
  const seq = drafts.batchSeq + 1
  const timestamp = nowLabel()
  const batch: MaintenanceBatch = {
    id: `BATCH-${String(seq).padStart(4, '0')}`,
    name: name?.trim() || `养护批次 ${seq}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    submittedAt: null,
    items: [],
  }
  readWriteDrafts({ ...drafts, batches: [...drafts.batches, batch], batchSeq: seq })
  return batch
}

function readWriteDrafts(next: DraftsState): void {
  commitJson({ [DRAFTS_KEY]: next })
}

function mutateBatch(batchId: string, mutate: (batch: MaintenanceBatch) => void): MaintenanceBatch {
  const drafts = loadDrafts()
  const index = drafts.batches.findIndex((batch) => batch.id === batchId)
  if (index < 0) {
    throw new Error(`没有找到养护批次 ${batchId}`)
  }
  const next: MaintenanceBatch = {
    ...drafts.batches[index],
    items: drafts.batches[index].items.map((item) => ({ ...item })),
  }
  mutate(next)
  next.updatedAt = nowLabel()
  const batches = [...drafts.batches]
  batches[index] = next
  readWriteDrafts({ ...drafts, batches })
  return next
}

export function addBatchItems(batchId: string, manholeIds: number[]): MaintenanceBatch {
  const current = manholeMap()
  return mutateBatch(batchId, (batch) => {
    const existing = new Set(batch.items.map((item) => item.manholeId))
    for (const manholeId of manholeIds) {
      if (existing.has(manholeId)) {
        continue
      }
      const manhole = current.get(manholeId)
      if (!manhole) {
        continue
      }
      // 已更换的井盖不再进批次：更换只生效一次，放进批次也没有意义。
      if (String(manhole.status) === REPLACED_STATUS) {
        continue
      }
      batch.items.push({ manholeId, addedAt: nowLabel(), remark: '' })
    }
  })
}

export function removeBatchItem(batchId: string, manholeId: number): MaintenanceBatch {
  return mutateBatch(batchId, (batch) => {
    batch.items = batch.items.filter((item) => item.manholeId !== manholeId)
  })
}

export function updateBatchItemRemark(
  batchId: string,
  manholeId: number,
  remark: string,
): MaintenanceBatch {
  return mutateBatch(batchId, (batch) => {
    const target = batch.items.find((item) => item.manholeId === manholeId)
    if (target) {
      target.remark = remark
    }
  })
}

export function discardBatch(batchId: string): void {
  const drafts = loadDrafts()
  readWriteDrafts({
    ...drafts,
    batches: drafts.batches.filter((batch) => batch.id !== batchId),
  })
}

export type ConfirmResult = {
  replaced: ReplacementEvent[]
  /** 命中幂等保护、已处于「已更换」的井盖编号。 */
  skippedDuplicates: number[]
  batchId: string | null
}

type CommitPayload = {
  manholeRows: EntryRow[]
  archiveRows: EntryRow[]
  drafts: DraftsState
  events: ReplacementEvent[]
}

// 先在内存里准备好全部写入内容，再交给 commitJson 原子落盘；
// 落盘抛错时 localStorage 已逐键回滚，这里同步回滚内存缓存，井盖与档案两侧保持一致。
function commit(payload: CommitPayload): void {
  const previousEntries = allRows()
  try {
    commitJson({
      // 与 local-store 的存储结构保持一致：所有模块共用一个键。
      [ENTRIES_KEY]: {
        ...previousEntries,
        manhole: payload.manholeRows,
        facility_archive: payload.archiveRows,
      },
      [DRAFTS_KEY]: payload.drafts,
      [REPLACEMENT_EVENTS_KEY]: { events: payload.events },
    })
    // 落盘成功后才更新内存缓存。
    Object.assign(previousEntries, {
      manhole: payload.manholeRows,
      facility_archive: payload.archiveRows,
    })
  } catch (error) {
    // commitJson 已回滚 localStorage；内存里我们尚未改动任何引用，无需额外处理。
    throw error instanceof Error
      ? new Error(`更换提交已整体回滚：${error.message}`)
      : new Error('更换提交已整体回滚，请稍后重试')
  }
}

function buildReplacement(
  manholeIds: number[],
  options: { batchId: string | null; operator: string; finalizeBatch?: boolean },
): { payload: CommitPayload; replaced: ReplacementEvent[]; skipped: number[] } | null {
  const all = allRows()
  const manholeRows = [...(all.manhole ?? [])]
  const archiveRows = [...(all.facility_archive ?? [])]
  const drafts = loadDrafts()
  const events = loadEvents()

  let batch: MaintenanceBatch | null = null
  if (options.batchId) {
    batch = drafts.batches.find((item) => item.id === options.batchId) ?? null
    if (!batch) {
      throw new Error(`没有找到养护批次 ${options.batchId}`)
    }
    if (options.finalizeBatch) {
      // 提交批次覆盖批次内全部井盖：被移出批次的井盖不属于本次提交。
      manholeIds = batch.items.map((item) => item.manholeId)
    }
  }

  // 幂等保护：同一井盖重复提交更换只生效一次。
  // 同时参考轨迹记录与井盖当前状态，任一命中都视为已更换。
  const alreadyReplaced = new Set(
    events
      .filter((event) => manholeIds.includes(event.manholeId))
      .map((event) => event.manholeId),
  )

  const timestamp = nowLabel()
  let eventSeq = drafts.eventSeq
  let archiveSeq = nextArchiveId(archiveRows)
  const replaced: ReplacementEvent[] = []
  const skipped: number[] = []

  for (const manholeId of manholeIds) {
    const index = manholeRows.findIndex((row) => Number(row.id) === manholeId)
    if (index < 0) {
      throw new Error(`没有找到编号为 ${manholeId} 的井盖设施`)
    }
    const current = manholeRows[index]
    if (String(current.status) === REPLACED_STATUS || alreadyReplaced.has(manholeId)) {
      skipped.push(manholeId)
      continue
    }
    const remark =
      batch?.items.find((item) => item.manholeId === manholeId)?.remark ?? ''

    // 井盖侧：状态置为「已更换」，待维护清零。
    manholeRows[index] = {
      ...current,
      status: REPLACED_STATUS,
      pending: false,
      abnormal: false,
      当前状态: REPLACED_STATUS,
    }

    // 档案侧：为该井盖新增一份「待更新」档案，设施档案页可直接看到。
    eventSeq += 1
    archiveSeq += 1
    const manholeCode = String(current['井盖编号'] ?? manholeId)
    const archiveRow: EntryRow = {
      id: archiveSeq,
      status: ARCHIVE_PENDING_STATUS,
      pending: true,
      abnormal: false,
      档案编号: `FACI-M-${String(manholeId).padStart(4, '0')}`,
      设施名称: `${manholeCode} 井盖更换档案`,
      设施类别: ARCHIVE_CATEGORY,
      所属区域: String(current['所属道路'] ?? ''),
      竣工日期: todayLabel(),
      设计图纸: `关联井盖 ${manholeCode}`,
      承建企业: '管网养护所',
      档案状态: ARCHIVE_PENDING_STATUS,
      变更来源: '井盖养护更换',
      关联井盖: manholeCode,
      养护批次: options.batchId ?? '',
    }
    archiveRows.push(archiveRow)

    const event: ReplacementEvent = {
      id: eventSeq,
      manholeId,
      batchId: options.batchId,
      replacedAt: timestamp,
      operator: options.operator,
      remark,
      archiveId: archiveRow.id as number,
    }
    events.push(event)
    replaced.push(event)
    alreadyReplaced.add(manholeId)
  }

  let nextBatches = drafts.batches
  if (batch) {
    nextBatches = drafts.batches.map((item) => {
      if (item.id !== batch!.id) {
        return item
      }
      // 单条「确认更换」只推进进度，批次仍是草稿，工作人员可暂存后继续。
      if (!options.finalizeBatch) {
        return { ...item, updatedAt: timestamp }
      }
      // 提交批次：事务里要求批次内全部井盖都已更换才置为已提交，
      // 否则保留草稿（理论上 replaced 覆盖了全部未更换井盖，不会走到这一分支）。
      const allReplaced = item.items.every(
        (member) =>
          String(
            manholeRows.find((row) => Number(row.id) === member.manholeId)?.status,
          ) === REPLACED_STATUS,
      )
      return {
        ...item,
        updatedAt: timestamp,
        submittedAt: allReplaced ? timestamp : item.submittedAt,
      }
    })
  }

  return {
    payload: {
      manholeRows,
      archiveRows,
      drafts: { ...drafts, batches: nextBatches, eventSeq },
      events,
    },
    replaced,
    skipped,
  }
}

export function confirmManholeReplacement(
  manholeId: number,
  operator: string,
  batchId?: string,
): ConfirmResult {
  const built = buildReplacement([manholeId], { batchId: batchId ?? null, operator })
  if (!built) {
    return { replaced: [], skippedDuplicates: [], batchId: batchId ?? null }
  }
  commit(built.payload)
  return {
    replaced: built.replaced,
    skippedDuplicates: built.skipped,
    batchId: batchId ?? null,
  }
}

// 提交整个批次：所有井盖更换、档案新增、轨迹记录与批次状态在同一个事务里落盘。
export function submitBatch(batchId: string, operator: string): ConfirmResult {
  const drafts = loadDrafts()
  const batch = drafts.batches.find((item) => item.id === batchId)
  if (!batch) {
    throw new Error(`没有找到养护批次 ${batchId}`)
  }
  if (batch.submittedAt) {
    // 已提交批次重复提交：幂等返回，不重复生成井盖更换与档案。
    return { replaced: [], skippedDuplicates: batch.items.map((item) => item.manholeId), batchId }
  }
  const ids = batch.items.map((item) => item.manholeId)
  const built = buildReplacement(ids, { batchId, operator, finalizeBatch: true })
  if (!built) {
    return { replaced: [], skippedDuplicates: [], batchId }
  }
  if (built.replaced.length === 0) {
    // 批次内井盖此前都已逐档更换：批次直接收尾，不重复产生档案。
    if (ids.every((id) => built.skipped.includes(id))) {
      const timestamp = nowLabel()
      const nextDrafts: DraftsState = {
        ...loadDrafts(),
        batches: loadDrafts().batches.map((item) =>
          item.id === batchId ? { ...item, updatedAt: timestamp, submittedAt: timestamp } : item,
        ),
      }
      readWriteDrafts(nextDrafts)
      return { replaced: [], skippedDuplicates: built.skipped, batchId }
    }
    throw new Error('批次内没有需要更换的井盖')
  }
  commit(built.payload)
  return { replaced: built.replaced, skippedDuplicates: built.skipped, batchId }
}

export type ReplacementTrajectoryItem = ReplacementEvent & {
  manholeCode: string
  road: string
  manholeType: string
  batchId: string | null
  archiveCode: string
}

// 更换轨迹：每次确认更换追加一条，刷新后仍然可查。
export function listReplacementTrajectory(): ReplacementTrajectoryItem[] {
  const lookup = manholeMap()
  const archives = new Map<number, EntryRow>()
  for (const row of listRows('facility_archive')) {
    archives.set(Number(row.id), row)
  }
  return loadEvents()
    .map((event) => {
      const manhole = lookup.get(event.manholeId)
      const archive = archives.get(event.archiveId)
      return {
        ...event,
        manholeCode: manhole ? String(manhole['井盖编号'] ?? event.manholeId) : `#${event.manholeId}`,
        road: manhole ? String(manhole['所属道路'] ?? '—') : '—',
        manholeType: manhole ? String(manhole['井盖类型'] ?? '—') : '—',
        archiveCode: archive ? String(archive['档案编号'] ?? '—') : '—',
      }
    })
    .sort((a, b) => b.id - a.id)
}

export function replacedManholeIds(): Set<number> {
  return new Set(loadEvents().map((event) => event.manholeId))
}

export type ManholeMaintenanceStats = {
  total: number
  pending: number
  inProgress: number
  replaced: number
  replacedToday: number
}

export function manholeMaintenanceStats(): ManholeMaintenanceStats {
  const rows = listRows('manhole')
  const today = todayLabel()
  const events = loadEvents()
  return {
    total: rows.length,
    pending: rows.filter((row) => String(row.status) === '待维护').length,
    inProgress: rows.filter((row) => String(row.status) === '维护中').length,
    replaced: rows.filter((row) => String(row.status) === REPLACED_STATUS).length,
    replacedToday: events.filter((event) => event.replacedAt.startsWith(today)).length,
  }
}
