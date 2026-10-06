import {
  allRows,
  commitEntriesAndWorkspace,
  getWorkspace,
  listRows,
  manholeStorageKey,
  saveWorkspace,
  storageKey,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ManholeBatch,
  ManholeWorkspace,
  ReplacementTrack,
} from '@/data/types'
import { filterRows } from '@/api/local-service'

const MANHOLE_KEY = 'manhole'
const ARCHIVE_KEY = 'facility_archive'
const REPLACED_STATUS = '已更换'
const ARCHIVE_WAIT_STATUS = '待更新'

// 供验证脚本/调试直接定位两个持久化键。
export const ENTRIES_KEY = storageKey()
export const WORKSPACE_KEY = manholeStorageKey()

function now(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

function today(): string {
  return now().slice(0, 10)
}

// ---- 页面筛选：刷新或重新进入井盖页时保留当前条件 ----

export function loadManholeFilters(): Record<string, string> {
  return { ...getWorkspace().filters }
}

export function persistManholeFilters(filters: Record<string, string>): void {
  const workspace = getWorkspace()
  workspace.filters = { ...filters }
  saveWorkspace(workspace)
}

// ---- 养护批次 ----

export function listBatches(): ManholeBatch[] {
  return [...getWorkspace().batches].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  )
}

export function getBatch(id: string): ManholeBatch | null {
  return getWorkspace().batches.find((item) => item.id === id) ?? null
}

export function loadActiveBatchId(): string | null {
  return getWorkspace().activeBatchId
}

function nextBatchId(batches: ManholeBatch[]): string {
  const prefix = `YHB-${today().replace(/-/g, '')}-`
  const seq =
    batches
      .filter((item) => item.id.startsWith(prefix))
      .map((item) => Number(item.id.slice(prefix.length)))
      .reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0) + 1
  return `${prefix}${String(seq).padStart(2, '0')}`
}

// 新建批次：按当前筛选结果入批（无筛选则全部入批），已更换的井盖不再进入新批次。
export function createBatch(filters: Record<string, string>): ActionResult & { batchId?: string } {
  const candidates = filterRows(listRows(MANHOLE_KEY), filters).filter(
    (row) => String(row.status) !== REPLACED_STATUS,
  )
  if (!candidates.length) {
    return { ok: false, message: '当前筛选下没有可养护的井盖，无法新建批次' }
  }
  const workspace = getWorkspace()
  const timestamp = now()
  const batch: ManholeBatch = {
    id: nextBatchId(workspace.batches),
    createdAt: timestamp,
    updatedAt: timestamp,
    submittedAt: null,
    status: 'draft',
    itemIds: candidates.map((row) => Number(row.id)),
    selectedIds: candidates.map((row) => Number(row.id)),
    replacedCount: 0,
  }
  workspace.batches = [...workspace.batches, batch]
  workspace.activeBatchId = batch.id
  saveWorkspace(workspace)
  return { ok: true, message: `批次 ${batch.id} 已创建，共纳入 ${batch.itemIds.length} 个井盖`, batchId: batch.id }
}

// 暂存勾选结果：工作人员可以离开再回来继续。
export function saveDraft(batchId: string, selectedIds: number[]): ActionResult {
  const workspace = getWorkspace()
  const index = workspace.batches.findIndex((item) => item.id === batchId)
  if (index < 0) {
    return { ok: false, message: `批次 ${batchId} 不存在或已被清理` }
  }
  const batch = workspace.batches[index]
  if (batch.status === 'submitted') {
    return { ok: false, message: `批次 ${batchId} 已提交，不能再修改` }
  }
  const allowed = new Set(batch.itemIds)
  const next = workspace.batches.slice()
  next[index] = {
    ...batch,
    selectedIds: selectedIds.filter((id) => allowed.has(id)),
    updatedAt: now(),
  }
  workspace.batches = next
  workspace.activeBatchId = batchId
  saveWorkspace(workspace)
  return { ok: true, message: '批次已暂存，可随时离开，回来后继续' }
}

export function setActiveBatch(batchId: string | null): void {
  const workspace = getWorkspace()
  workspace.activeBatchId = batchId
  saveWorkspace(workspace)
}

// 按 所属道路 / 井盖类型 / 养护周期 给批次内井盖分组。
export type ManholeGroup = { key: string; road: string; type: string; cycle: string; rows: EntryRow[] }

export function groupedBatchItems(batch: ManholeBatch): ManholeGroup[] {
  const ids = new Set(batch.itemIds)
  const items = listRows(MANHOLE_KEY).filter((row) => ids.has(Number(row.id)))
  const groups = new Map<string, ManholeGroup>()
  for (const row of items) {
    const road = String(row['所属道路'] ?? '未填写道路')
    const type = String(row['井盖类型'] ?? '未填写类型')
    const cycle = String(row['养护周期'] ?? '未填写周期')
    const key = `${road}/${type}/${cycle}`
    const group = groups.get(key) ?? { key, road, type, cycle, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh-Hans-CN'))
}

// ---- 更换轨迹 ----

export function listTracks(): ReplacementTrack[] {
  return [...getWorkspace().tracks].sort((a, b) => (a.replacedAt < b.replacedAt ? 1 : -1))
}

function nextTrackId(tracks: ReplacementTrack[]): number {
  return tracks.reduce((max, item) => (item.id > max ? item.id : max), 0) + 1
}

function nextArchiveId(rows: EntryRow[]): number {
  return rows.reduce((max, item) => (Number(item.id) > max ? Number(item.id) : max), 0)
}

function buildArchiveRow(id: number, row: EntryRow): EntryRow {
  return {
    id,
    status: ARCHIVE_WAIT_STATUS,
    // 待更新档案要进运营概览的「待处理」。
    pending: true,
    abnormal: false,
    档案编号: `FACI-MH-${String(id).padStart(4, '0')}`,
    设施名称: `井盖 ${String(row['井盖编号'] ?? '')} 更换待更新`,
    设施类别: `井盖设施/${String(row['井盖类型'] ?? '未知类型')}`,
    所属区域: String(row['所属道路'] ?? ''),
    竣工日期: today(),
    设计图纸: '更换后待补录',
    档案状态: ARCHIVE_WAIT_STATUS,
  }
}

function buildTrack(
  id: number,
  row: EntryRow,
  archiveId: number,
  archiveCode: string,
  source: string,
  batchId: string | null,
): ReplacementTrack {
  return {
    id,
    manholeId: Number(row.id),
    井盖编号: String(row['井盖编号'] ?? ''),
    所属道路: String(row['所属道路'] ?? ''),
    井盖类型: String(row['井盖类型'] ?? ''),
    养护周期: String(row['养护周期'] ?? ''),
    source,
    batchId,
    archiveId,
    档案编号: archiveCode,
    replacedAt: now(),
  }
}

// 一次性落库：井盖置为已更换 + 档案新增待更新 + 批次/轨迹推进，同生共死。
// 先在内存里把所有改动算好，再通过原子提交一起写入；任何一步写失败整体回滚，
// 不会出现井盖侧已完成、档案侧仍待维护（或反过来）的撕裂状态。
function commitReplacements(
  targets: EntryRow[],
  source: string,
  batchId: string | null,
): { entries: Record<string, EntryRow[]>; workspace: ManholeWorkspace; tracks: ReplacementTrack[] } {
  const entries = allRows()
  const manholeRows = [...(entries[MANHOLE_KEY] ?? [])]
  const archiveRows = [...(entries[ARCHIVE_KEY] ?? [])]
  const workspace = getWorkspace()
  const tracks = [...workspace.tracks]

  let archiveId = nextArchiveId(archiveRows)
  let trackId = nextTrackId(tracks)
  let replacedCount = 0

  for (const target of targets) {
    const index = manholeRows.findIndex((row) => Number(row.id) === Number(target.id))
    if (index < 0) {
      continue
    }
    // 双保险幂等：状态已是已更换或轨迹已记录过，都跳过，同一井盖重复提交只生效一次。
    if (String(manholeRows[index].status) === REPLACED_STATUS) {
      continue
    }
    if (tracks.some((item) => item.manholeId === Number(target.id))) {
      continue
    }
    archiveId += 1
    trackId += 1
    const archive = buildArchiveRow(archiveId, manholeRows[index])
    archiveRows.push(archive)
    tracks.push(
      buildTrack(trackId, manholeRows[index], archiveId, String(archive['档案编号']), source, batchId),
    )
    manholeRows[index] = {
      ...manholeRows[index],
      status: REPLACED_STATUS,
      pending: false,
    }
    replacedCount += 1
  }

  const batches = workspace.batches.map((batch) => {
    if (batch.id !== batchId) {
      return batch
    }
    return {
      ...batch,
      selectedIds: batch.selectedIds.filter(
        (id) => !targets.some((target) => Number(target.id) === id),
      ),
      replacedCount: batch.replacedCount + replacedCount,
      updatedAt: now(),
      submittedAt: batch.status === 'draft' ? now() : batch.submittedAt,
      status: 'submitted' as const,
    }
  })

  return {
    entries: { ...entries, [MANHOLE_KEY]: manholeRows, [ARCHIVE_KEY]: archiveRows },
    workspace: {
      ...workspace,
      batches,
      tracks,
      activeBatchId: batchId === null ? workspace.activeBatchId : null,
    },
    tracks: tracks.slice(tracks.length - replacedCount),
  }
}

// 批次确认更换。
export function submitBatch(batchId: string): ActionResult {
  const workspace = getWorkspace()
  const batch = workspace.batches.find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: `批次 ${batchId} 不存在或已被清理` }
  }
  if (batch.status === 'submitted') {
    return { ok: false, message: `批次 ${batchId} 已提交过更换，重复提交不会再次生效` }
  }
  const selected = new Set(batch.selectedIds)
  if (!selected.size) {
    return { ok: false, message: '请至少勾选一个需要更换的井盖后再提交' }
  }
  const targets = listRows(MANHOLE_KEY).filter(
    (row) => selected.has(Number(row.id)) && String(row.status) !== REPLACED_STATUS,
  )
  if (!targets.length) {
    return { ok: false, message: '勾选的井盖均已更换，没有可提交的更换' }
  }
  const plan = commitReplacements(targets, `养护批次 ${batchId}`, batchId)
  try {
    commitEntriesAndWorkspace(plan.entries, plan.workspace)
  } catch {
    return { ok: false, message: '更换写入失败，井盖与档案均未改动，请重试' }
  }
  return {
    ok: true,
    message: `批次 ${batchId} 已提交：${plan.tracks.length} 个井盖完成更换，设施档案已新增待更新档案`,
  }
}

// 台账行内「确认更换」：走同一条原子通道，单井盖更换也同时落轨迹与待更新档案。
export function replaceSingleManhole(id: number): ActionResult {
  const row = listRows(MANHOLE_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的井盖设施` }
  }
  if (String(row.status) === REPLACED_STATUS) {
    return { ok: false, message: '该井盖已更换，重复提交只生效一次' }
  }
  if (getWorkspace().tracks.some((item) => item.manholeId === id)) {
    return { ok: false, message: '该井盖已有更换记录，不能重复更换' }
  }
  const plan = commitReplacements([row], '台账直接更换', null)
  try {
    commitEntriesAndWorkspace(plan.entries, plan.workspace)
  } catch {
    return { ok: false, message: '更换写入失败，井盖与档案均未改动，请重试' }
  }
  return { ok: true, message: '井盖已更换，设施档案已新增待更新档案' }
}
