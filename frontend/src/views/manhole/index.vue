<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>井盖设施管理</h2>
        <p class="page-desc">登记井盖台账，按道路、井盖类型与养护周期组建养护批次，确认更换后同步设施档案待更新与运营概览。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出井盖设施清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}<em v-if="tab.badge" class="tab-badge">{{ tab.badge }}</em>
      </button>
    </nav>

    <!-- 井盖台账 -->
    <div v-show="activeTab === 'ledger'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无井盖设施数据</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条井盖设施记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </div>

    <!-- 养护批次 -->
    <div v-show="activeTab === 'batch'">
      <div class="batch-toolbar">
        <button class="btn primary" type="button" @click="openCreate">新建养护批次</button>
        <span class="batch-tip">按当前台账筛选入批，未提交的批次会暂存在本机，刷新或离开后回来可继续。</span>
      </div>

      <!-- 批次工作区 -->
      <div v-if="activeBatch" class="batch-workspace">
        <div class="batch-head">
          <div>
            <strong>批次 {{ activeBatch.id }}</strong>
            <span class="batch-meta">
              建批于 {{ activeBatch.createdAt }} · 共 {{ activeBatch.itemIds.length }} 个井盖 ·
              <template v-if="activeBatch.status === 'draft'">
                已勾选 {{ selectedRows.length }} 个待更换
              </template>
              <template v-else>已提交，完成更换 {{ activeBatch.replacedCount }} 个（{{ activeBatch.submittedAt }}）</template>
            </span>
          </div>
          <div class="batch-actions">
            <template v-if="activeBatch.status === 'draft'">
              <button class="btn" type="button" @click="stashDraft">暂存并返回</button>
              <button class="btn primary" type="button" @click="confirmBatch">确认更换</button>
            </template>
            <button class="btn ghost" type="button" @click="closeBatch">
              {{ activeBatch.status === 'draft' ? '关闭（自动暂存）' : '返回批次列表' }}
            </button>
          </div>
        </div>

        <div v-for="group in groups" :key="group.key" class="batch-group">
          <label class="group-head">
            <input
              type="checkbox"
              :checked="isGroupAllChecked(group)"
              :indeterminate.prop="isGroupIndeterminate(group)"
              :disabled="activeBatch.status === 'submitted'"
              @change="toggleGroup(group, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ group.road }} / {{ group.type }} / 养护周期 {{ group.cycle }}</span>
            <em>{{ group.rows.length }} 个</em>
          </label>
          <ul class="group-items">
            <li v-for="row in group.rows" :key="String(row.id)">
              <label>
                <input
                  type="checkbox"
                  :value="Number(row.id)"
                  v-model="selectedIds"
                  :disabled="activeBatch.status === 'submitted' || String(row.status) === '已更换'"
                />
                <span>{{ row['井盖编号'] }} · {{ row['井盖材质'] }} · {{ row['规格尺寸'] }}</span>
              </label>
              <span class="item-status" :class="{ done: String(row.status) === '已更换' }">{{ row.status }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- 批次列表 -->
      <template v-else>
        <table class="data-table">
          <thead>
            <tr>
              <th>批次编号</th><th>创建时间</th><th>井盖数</th><th>已勾更换</th>
              <th>已完成更换</th><th>批次状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in batches" :key="batch.id">
              <td>{{ batch.id }}</td>
              <td>{{ batch.createdAt }}</td>
              <td>{{ batch.itemIds.length }}</td>
              <td>{{ batch.status === 'draft' ? batch.selectedIds.length : '—' }}</td>
              <td>{{ batch.replacedCount }}</td>
              <td>{{ batch.status === 'draft' ? '暂存中' : '已提交' }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="continueBatch(batch)">
                  {{ batch.status === 'draft' ? '继续批次' : '查看明细' }}
                </button>
              </td>
            </tr>
            <tr v-if="!batches.length">
              <td colspan="7" class="empty-state">还没有养护批次，先按筛选条件新建一个批次</td>
            </tr>
          </tbody>
        </table>
      </template>

      <footer class="page-foot">
        <span v-if="!errorMessage">同一井盖重复提交更换只生效一次；确认更换时井盖与档案原子写入，失败则全部不变。</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </div>

    <!-- 更换轨迹 -->
    <div v-show="activeTab === 'track'">
      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>井盖编号 / 所属道路</span>
          <input v-model="trackKeyword" placeholder="按编号或道路检索" />
        </label>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>井盖编号</th><th>所属道路</th><th>井盖类型</th><th>养护周期</th>
            <th>关联批次</th><th>新增待更新档案</th><th>更换时间</th><th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="track in filteredTracks" :key="track.id">
            <td>{{ track.井盖编号 }}</td>
            <td>{{ track.所属道路 }}</td>
            <td>{{ track.井盖类型 }}</td>
            <td>{{ track.养护周期 }}</td>
            <td>{{ track.batchId ?? '—' }}</td>
            <td>{{ track.档案编号 }}</td>
            <td>{{ track.replacedAt }}</td>
            <td>{{ track.source }}</td>
          </tr>
          <tr v-if="!filteredTracks.length">
            <td colspan="8" class="empty-state">暂无更换记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  createBatch,
  getBatch,
  groupedBatchItems,
  listBatches,
  listTracks,
  loadActiveBatchId,
  loadManholeFilters,
  persistManholeFilters,
  replaceSingleManhole,
  saveDraft,
  setActiveBatch,
  submitBatch,
} from '@/api/manhole-service'
import type { EntryRow, ManholeBatch } from '@/data/types'

const meta = moduleMeta('manhole')
// 「当前状态」由独立的状态列展示，避免重复渲染字段里的占位值。
const columns = ["井盖编号", "所属道路", "井盖类型", "井盖材质", "规格尺寸", "安装日期", "养护周期"]
const filterFields = ["井盖编号", "所属道路", "井盖类型"]
// 确认更换走批次/单井盖的原子通道；台账上仍保留申请与开始维护。
const actions = ["申请维护", "开始维护", "确认更换"]
const statuses = ["正常", "待维护", "维护中", "已更换"]

const activeTab = ref<'ledger' | 'batch' | 'track'>('ledger')
const tabs = computed(() => [
  { key: 'ledger' as const, label: '井盖台账', badge: 0 },
  { key: 'batch' as const, label: '养护批次', badge: draftCount.value },
  { key: 'track' as const, label: '更换轨迹', badge: 0 },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '井盖总数', value: allManholeRows.value.length },
  { label: '待维护井盖', value: countStatus('待维护') + countStatus('维护中') },
  { label: '已更换井盖', value: countStatus('已更换') },
])
const allManholeRows = ref<EntryRow[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function countStatus(status: string): number {
  return allManholeRows.value.filter((row) => String(row.status) === status).length
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allManholeRows.value = listEntries(meta.key).items
    persistManholeFilters(filters.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '井盖设施列表读取失败'
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  // 确认更换必须同时写井盖、档案、轨迹：走原子服务，保证两侧一致且不重复。
  if (action === '确认更换') {
    const result = replaceSingleManhole(Number(row.id))
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    errorMessage.value = ''
    reload()
    refreshBatches()
    refreshTracks()
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// ---- 养护批次 ----

const batches = ref<ManholeBatch[]>([])
const activeBatchId = ref<string | null>(null)
const activeBatch = ref<ManholeBatch | null>(null)
const selectedIds = ref<number[]>([])
const groups = ref<ReturnType<typeof groupedBatchItems>>([])
const selectedRows = computed(() => {
  const chosen = new Set(selectedIds.value)
  return groups.value.flatMap((group) => group.rows.filter((row) => chosen.has(Number(row.id))))
})

function refreshBatches() {
  batches.value = listBatches()
  if (activeBatchId.value) {
    activeBatch.value = getBatch(activeBatchId.value)
    if (activeBatch.value) {
      groups.value = groupedBatchItems(activeBatch.value)
    }
  }
}

function openCreate() {
  errorMessage.value = ''
  const result = createBatch(filters.value)
  if (!result.ok || !result.batchId) {
    errorMessage.value = result.message
    return
  }
  enterBatch(result.batchId)
}

function continueBatch(batch: ManholeBatch) {
  errorMessage.value = ''
  enterBatch(batch.id)
}

function enterBatch(batchId: string) {
  watchReady = false
  activeBatchId.value = batchId
  setActiveBatch(batchId)
  activeBatch.value = getBatch(batchId)
  selectedIds.value = activeBatch.value ? [...activeBatch.value.selectedIds] : []
  groups.value = activeBatch.value ? groupedBatchItems(activeBatch.value) : []
  // 等本次赋值的响应式副作用跑完，再开始监听用户勾选。
  void Promise.resolve().then(() => {
    watchReady = true
  })
}

function closeBatch() {
  if (activeBatch.value?.status === 'draft') {
    saveDraft(activeBatch.value.id, selectedIds.value)
  }
  watchReady = false
  activeBatchId.value = null
  setActiveBatch(null)
  activeBatch.value = null
  selectedIds.value = []
  groups.value = []
  refreshBatches()
}

function stashDraft() {
  if (!activeBatch.value) {
    return
  }
  const result = saveDraft(activeBatch.value.id, selectedIds.value)
  errorMessage.value = result.ok ? '' : result.message
  closeBatch()
}

function confirmBatch() {
  if (!activeBatch.value) {
    return
  }
  // 显式暂存一次勾选，保证提交与暂存使用同一份勾选集合。
  watchReady = false
  const saved = saveDraft(activeBatch.value.id, selectedIds.value)
  if (!saved.ok) {
    errorMessage.value = saved.message
    watchReady = true
    return
  }
  const result = submitBatch(activeBatch.value.id)
  errorMessage.value = result.ok ? '' : result.message
  reload()
  refreshBatches()
  if (result.ok && activeBatchId.value) {
    activeBatch.value = getBatch(activeBatchId.value)
    groups.value = activeBatch.value ? groupedBatchItems(activeBatch.value) : []
    selectedIds.value = activeBatch.value ? [...activeBatch.value.selectedIds] : []
  }
  void Promise.resolve().then(() => {
    watchReady = true
  })
  refreshTracks()
}

function isGroupAllChecked(group: (typeof groups.value)[number]): boolean {
  return group.rows.every((row) => selectedIds.value.includes(Number(row.id)))
}

function isGroupIndeterminate(group: (typeof groups.value)[number]): boolean {
  const picked = group.rows.filter((row) => selectedIds.value.includes(Number(row.id))).length
  return picked > 0 && picked < group.rows.length
}

function toggleGroup(group: (typeof groups.value)[number], checked: boolean) {
  const groupIds = group.rows
    .filter((row) => String(row.status) !== '已更换')
    .map((row) => Number(row.id))
  const rest = selectedIds.value.filter((id) => !groupIds.includes(id))
  selectedIds.value = checked ? [...rest, ...groupIds] : rest
}

// 勾选变化即暂存草稿：离开页面、刷新或切走再回来，未提交批次都保留。
// 恢复批次时的首次赋值不算用户改动，避免把暂存时间顶成刷新时间。
let watchReady = false
watch(selectedIds, (value) => {
  if (!watchReady) {
    return
  }
  if (activeBatch.value?.status === 'draft') {
    saveDraft(activeBatch.value.id, value)
  }
}, { deep: true })

const draftCount = computed(() => batches.value.filter((batch) => batch.status === 'draft').length)

// ---- 更换轨迹 ----

const tracks = ref(listTracks())
const trackKeyword = ref('')
const filteredTracks = computed(() => {
  const keyword = trackKeyword.value.trim()
  if (!keyword) {
    return tracks.value
  }
  return tracks.value.filter(
    (track) => track.井盖编号.includes(keyword) || track.所属道路.includes(keyword),
  )
})

function refreshTracks() {
  tracks.value = listTracks()
}

function switchTab(key: 'ledger' | 'batch' | 'track') {
  activeTab.value = key
  errorMessage.value = ''
  if (key === 'batch') {
    refreshBatches()
  }
  if (key === 'track') {
    refreshTracks()
  }
}

onMounted(() => {
  filters.value = loadManholeFilters()
  reload()
  refreshBatches()
  // 刷新或重新进入时，自动打开未提交完的批次。
  const activeId = loadActiveBatchId()
  if (activeId && getBatch(activeId)) {
    activeTab.value = 'batch'
    enterBatch(activeId)
  }
  refreshTracks()
})
</script>

<style scoped>
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-btn {
  position: relative;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
}
.tab-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tab-badge {
  font-style: normal;
  margin-left: 6px;
  background: #fef0c7;
  color: #92400e;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 11px;
}
.tab-btn.active .tab-badge { background: rgba(255, 255, 255, 0.25); color: #fff; }
.batch-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.batch-tip { color: var(--muted); font-size: 12px; }
.batch-workspace { border: 1px solid var(--border); border-radius: 8px; background: #fff; padding: 12px; }
.batch-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.batch-meta { margin-left: 10px; color: var(--muted); font-size: 12px; }
.batch-actions { display: flex; gap: 8px; }
.batch-group { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 10px; }
.group-head { display: flex; align-items: center; gap: 8px; background: #f1f5f9; padding: 8px 10px; font-size: 13px; cursor: pointer; }
.group-head em { font-style: normal; color: var(--muted); font-size: 12px; margin-left: auto; }
.group-items { list-style: none; margin: 0; padding: 6px 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px 16px; }
.group-items li { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.group-items label { display: flex; align-items: center; gap: 6px; }
.item-status { font-size: 12px; color: var(--muted); }
.item-status.done { color: #047857; }
</style>
