<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>井盖设施管理</h2>
        <p class="page-desc">维护井盖设施，围绕井盖编号、所属道路、井盖类型、井盖材质做登记、筛选与状态流转，并支持按养护批次集中更换。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="startBatch">新建养护批次</button>
        <button class="btn" type="button" @click="exportRows">导出井盖设施清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 暂存提示：存在未提交批次时，刷新或重新进入仍可继续作业。 -->
    <div v-if="draftBatch && !activeBatch" class="draft-banner">
      <span>
        检测到暂存批次「{{ draftBatch.name }}」（{{ draftBatch.id }}，{{ draftBatch.updatedAt }} 暂存，{{ draftBatch.items.length }} 个井盖），
        可以继续上次的养护作业。
      </span>
      <span class="row-actions">
        <button class="btn primary" type="button" @click="resumeDraft">继续批次</button>
        <button class="btn ghost" type="button" @click="discardDraft">放弃草稿</button>
      </span>
    </div>

    <!-- 养护批次工作台 -->
    <section v-if="activeBatch" class="batch-panel">
      <header class="batch-head">
        <div>
          <h3>养护批次 {{ activeBatch.id }} · {{ activeBatch.name }}</h3>
          <p class="page-desc">
            按「所属道路 / 井盖类型 / 养护周期」分组，{{ activeBatch.submittedAt ? '该批次已提交' : '内容自动暂存，可随时离开后回来继续' }}
            <template v-if="activeBatch.submittedAt"> · 提交时间 {{ activeBatch.submittedAt }}</template>
          </p>
        </div>
        <div class="page-actions">
          <button
            v-if="!activeBatch.submittedAt"
            class="btn primary"
            type="button"
            :disabled="pendingItemIds.length === 0"
            @click="submitActiveBatch"
          >
            提交批次（{{ pendingItemIds.length }} 个待更换）
          </button>
          <button class="btn ghost" type="button" @click="closeBatch">关闭工作台</button>
        </div>
      </header>

      <p v-if="batchGroups.length === 0" class="empty-state batch-empty">
        批次还没有井盖，请在下方清单中勾选「加入批次」，或直接批量加入当前筛选结果。
      </p>

      <div v-for="group in batchGroups" :key="group.key" class="batch-group">
        <h4 class="group-title">
          {{ group.road }} · {{ group.manholeType }} · {{ group.cycle }}
          <span class="group-count">{{ group.items.length }} 个</span>
        </h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>井盖编号</th>
              <th>井盖材质</th>
              <th>规格尺寸</th>
              <th>当前状态</th>
              <th>养护备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in group.items" :key="member.manholeId">
              <td>{{ member.manhole['井盖编号'] }}</td>
              <td>{{ member.manhole['井盖材质'] }}</td>
              <td>{{ member.manhole['规格尺寸'] }}</td>
              <td>
                <span :class="{ 'replaced-tag': isReplaced(member.manholeId) }">
                  {{ member.manhole.status }}
                </span>
              </td>
              <td>
                <input
                  :value="member.remark"
                  class="remark-input"
                  :disabled="!!activeBatch.submittedAt || isReplaced(member.manholeId)"
                  placeholder="更换说明（选填）"
                  @change="saveRemark(member.manholeId, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="row-actions">
                <button
                  v-if="!activeBatch.submittedAt && !isReplaced(member.manholeId)"
                  class="link"
                  type="button"
                  @click="confirmOne(member.manholeId, activeBatch.id)"
                >
                  确认更换
                </button>
                <button
                  v-if="!activeBatch.submittedAt && !isReplaced(member.manholeId)"
                  class="link danger"
                  type="button"
                  @click="removeItem(member.manholeId)"
                >
                  移出批次
                </button>
                <span v-if="isReplaced(member.manholeId)" class="muted-text">已生成更换档案</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <button
        v-if="activeBatch && !activeBatch.submittedAt"
        class="btn"
        type="button"
        :disabled="addableRows.length === 0"
        @click="addFilteredToBatch"
      >
        筛选结果加入批次（{{ addableRows.length }}）
      </button>
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
              v-if="!isReplaced(Number(row.id))"
              class="link"
              type="button"
              @click="confirmOne(Number(row.id), inBatch(Number(row.id)) ? activeBatch?.id : undefined)"
            >
              确认更换
            </button>
            <template v-if="activeBatch && !activeBatch.submittedAt">
              <button
                v-if="!inBatch(Number(row.id)) && !isReplaced(Number(row.id))"
                class="link"
                type="button"
                @click="addToBatch(Number(row.id))"
              >
                加入批次
              </button>
              <span v-else-if="inBatch(Number(row.id))" class="muted-text">已在批次中</span>
            </template>
            <span v-if="isReplaced(Number(row.id))" class="muted-text">已更换，不可重复提交</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无井盖设施数据，可先调整筛选条件</td>
        </tr>
      </tbody>
    </table>

    <!-- 更换轨迹 -->
    <section class="trajectory-panel">
      <header class="batch-head">
        <div>
          <h3>更换轨迹</h3>
          <p class="page-desc">每次确认更换都会追加一条轨迹，并同步在设施档案页生成「待更新」档案；同一井盖重复提交只生效一次。</p>
        </div>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>更换时间</th>
            <th>井盖编号</th>
            <th>所属道路</th>
            <th>井盖类型</th>
            <th>所属批次</th>
            <th>待更新档案</th>
            <th>作业人员</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in trajectory" :key="event.id">
            <td>{{ event.replacedAt }}</td>
            <td>{{ event.manholeCode }}</td>
            <td>{{ event.road }}</td>
            <td>{{ event.manholeType }}</td>
            <td>{{ event.batchId ?? '批次外直接更换' }}</td>
            <td>{{ event.archiveCode }}</td>
            <td>{{ event.operator }}</td>
            <td>{{ event.remark || '—' }}</td>
          </tr>
          <tr v-if="!trajectory.length">
            <td colspan="8" class="empty-state">暂无更换记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条井盖设施记录；筛选条件与未提交批次已保存在本机浏览器</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  addBatchItems,
  confirmManholeReplacement,
  createBatch,
  discardBatch,
  groupBatchItems,
  listBatches,
  listReplacementTrajectory,
  manholeMaintenanceStats,
  removeBatchItem,
  replacedManholeIds,
  submitBatch,
  updateBatchItemRemark,
  type BatchGroup,
  type MaintenanceBatch,
  type ReplacementTrajectoryItem,
} from '@/api/maintenance'
import { useSessionStore } from '@/stores/session'
import { clearUiState, loadUiState, saveUiState } from '@/api/ui-state'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('manhole')
const session = useSessionStore()
const columns = ['井盖编号', '所属道路', '井盖类型', '井盖材质', '规格尺寸', '安装日期', '养护周期']
const filterFields = ['井盖编号', '所属道路', '井盖类型']
const FILTER_STATE_KEY = 'manhole-filters'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>(loadUiState(FILTER_STATE_KEY, {}))
const replacedIds = ref<Set<number>>(new Set())
const trajectory = ref<ReplacementTrajectoryItem[]>([])
const draftBatch = ref<MaintenanceBatch | null>(null)
const activeBatch = ref<MaintenanceBatch | null>(null)
const batchGroups = ref<BatchGroup[]>([])

const stats = computed(() => {
  const summary = manholeMaintenanceStats()
  return [
    { label: '井盖总数', value: summary.total },
    { label: '待维护井盖', value: summary.pending },
    { label: '维护中井盖', value: summary.inProgress },
    { label: '已更换井盖', value: summary.replaced },
  ]
})

const statusSummary = computed(() => {
  const statuses = ['正常', '待维护', '维护中', '已更换']
  return statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  }))
})

const inBatchIds = computed(
  () => new Set((activeBatch.value?.items ?? []).map((item) => item.manholeId)),
)

// 批次内尚未更换的井盖：已提交过更换的不再重复提交。
const pendingItemIds = computed(() =>
  (activeBatch.value?.items ?? [])
    .map((item) => item.manholeId)
    .filter((id) => !replacedIds.value.has(id)),
)

const addableRows = computed(() =>
  rows.value
    .map((row) => Number(row.id))
    .filter((id) => !inBatchIds.value.has(id) && !replacedIds.value.has(id)),
)

function isReplaced(id: number): boolean {
  return replacedIds.value.has(id)
}

function inBatch(id: number): boolean {
  return inBatchIds.value.has(id)
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    replacedIds.value = replacedManholeIds()
    trajectory.value = listReplacementTrajectory()
    draftBatch.value = listBatches().find((batch) => batch.submittedAt === null) ?? null
    if (activeBatch.value) {
      const refreshed =
        listBatches().find((batch) => batch.id === activeBatch.value?.id) ?? null
      activeBatch.value = refreshed
      batchGroups.value = refreshed ? groupBatchItems(refreshed.items) : []
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '井盖设施列表读取失败'
  }
}

function resetFilters() {
  filters.value = {}
  clearUiState(FILTER_STATE_KEY)
  reload()
}

function startBatch() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (draftBatch.value) {
      resumeDraft()
      return
    }
    activeBatch.value = createBatch()
    batchGroups.value = []
    noticeMessage.value = '新批次已创建，勾选井盖后内容会自动暂存'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '新建养护批次失败'
  }
}

function resumeDraft() {
  if (!draftBatch.value) {
    return
  }
  activeBatch.value = draftBatch.value
  batchGroups.value = groupBatchItems(draftBatch.value.items)
  noticeMessage.value = `已恢复暂存批次「${draftBatch.value.name}」`
}

function closeBatch() {
  activeBatch.value = null
  batchGroups.value = []
}

function discardDraft() {
  errorMessage.value = ''
  try {
    if (draftBatch.value) {
      discardBatch(draftBatch.value.id)
    }
    if (activeBatch.value && !activeBatch.value.submittedAt) {
      activeBatch.value = null
      batchGroups.value = []
    }
    noticeMessage.value = '暂存批次已放弃'
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '放弃草稿失败'
  }
}

function addToBatch(manholeId: number) {
  if (!activeBatch.value) {
    return
  }
  errorMessage.value = ''
  try {
    activeBatch.value = addBatchItems(activeBatch.value.id, [manholeId])
    batchGroups.value = groupBatchItems(activeBatch.value.items)
    noticeMessage.value = '已加入批次，内容已自动暂存'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加入批次失败'
  }
}

function addFilteredToBatch() {
  if (!activeBatch.value) {
    return
  }
  errorMessage.value = ''
  try {
    activeBatch.value = addBatchItems(activeBatch.value.id, addableRows.value)
    batchGroups.value = groupBatchItems(activeBatch.value.items)
    noticeMessage.value = '当前筛选结果已加入批次并暂存'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批量加入批次失败'
  }
}

function removeItem(manholeId: number) {
  if (!activeBatch.value) {
    return
  }
  errorMessage.value = ''
  try {
    activeBatch.value = removeBatchItem(activeBatch.value.id, manholeId)
    batchGroups.value = groupBatchItems(activeBatch.value.items)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '移出批次失败'
  }
}

function saveRemark(manholeId: number, remark: string) {
  if (!activeBatch.value) {
    return
  }
  try {
    activeBatch.value = updateBatchItemRemark(activeBatch.value.id, manholeId, remark)
  } catch {
    // 备注保存失败不打断作业，下一次操作时会重新加载。
  }
}

// 确认更换：井盖状态、设施档案、更换轨迹、批次进度在同一个存储事务里提交。
function handleCommitResult(
  result: { replaced: Array<{ manholeId: number }>; skippedDuplicates: number[] },
  scopeLabel: string,
) {
  if (result.replaced.length > 0) {
    noticeMessage.value = `${scopeLabel}成功：${result.replaced.length} 个井盖已更换，设施档案已生成待更新记录`
  }
  if (result.skippedDuplicates.length > 0) {
    errorMessage.value = `井盖 ${result.skippedDuplicates.join('、')} 已更换，重复提交未生效`
  } else {
    errorMessage.value = ''
  }
  reload()
}

function confirmOne(manholeId: number, batchId?: string) {
  noticeMessage.value = ''
  try {
    const result = confirmManholeReplacement(manholeId, session.operator, batchId)
    handleCommitResult(result, '更换')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '确认更换失败，井盖与档案均未改动'
  }
}

function submitActiveBatch() {
  if (!activeBatch.value) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = submitBatch(activeBatch.value.id, session.operator)
    handleCommitResult(result, '批次提交')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批次提交失败，井盖与档案均未改动'
  }
}

// 筛选条件变化时立即持久化，刷新或重新进入页面时保留。
watch(
  filters,
  (value) => {
    saveUiState(FILTER_STATE_KEY, value)
  },
  { deep: true },
)

onMounted(() => {
  reload()
})
</script>

<style scoped>
.draft-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: #fff8e6;
  border: 1px solid #f0c36d;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.batch-panel,
.trajectory-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.batch-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}
.batch-head h3 {
  margin: 0 0 2px;
  font-size: 15px;
}
.batch-empty {
  padding: 12px 0;
}
.batch-group {
  margin-bottom: 12px;
}
.group-title {
  margin: 8px 0 6px;
  font-size: 13px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.group-count {
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  color: var(--muted);
  font-weight: normal;
}
.remark-input {
  width: 180px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
}
.replaced-tag {
  color: #047857;
  font-weight: 600;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.link.danger {
  color: #b42318;
}
.notice-text {
  color: #047857;
}
</style>
