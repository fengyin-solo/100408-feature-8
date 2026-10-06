/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 井盖养护批次：入批井盖在新建时快照，勾选本次要更换的井盖后可暂存（draft）或提交（submitted）。
export type ManholeBatch = {
  id: string
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  status: 'draft' | 'submitted'
  itemIds: number[]
  selectedIds: number[]
  replacedCount: number
}

// 更换轨迹：每次确认更换成功落一条，同一井盖只可能有一条，是「只生效一次」的幂等依据。
export type ReplacementTrack = {
  id: number
  manholeId: number
  井盖编号: string
  所属道路: string
  井盖类型: string
  养护周期: string
  source: string
  batchId: string | null
  archiveId: number
  档案编号: string
  replacedAt: string
}

// 井盖页工作区：批次、轨迹、页面筛选与当前打开的批次都在这里，刷新/重进时原样恢复。
export type ManholeWorkspace = {
  batches: ManholeBatch[]
  tracks: ReplacementTrack[]
  filters: Record<string, string>
  activeBatchId: string | null
}
