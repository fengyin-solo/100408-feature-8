<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <!-- 井盖养护同步区：确认更换后这里实时反映维护状态与待更新档案。 -->
    <section class="maintenance-panel">
      <h3>井盖养护动态</h3>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">井盖总数</span>
          <strong class="stat-value">{{ maintenance.total }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待维护井盖</span>
          <strong class="stat-value">{{ maintenance.pending }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">维护中井盖</span>
          <strong class="stat-value">{{ maintenance.inProgress }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已更换井盖</span>
          <strong class="stat-value">{{ maintenance.replaced }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">今日更换</span>
          <strong class="stat-value">{{ maintenance.replacedToday }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>更换时间</th><th>井盖编号</th><th>所属道路</th><th>井盖类型</th><th>所属批次</th><th>待更新档案</th><th>作业人员</th></tr>
        </thead>
        <tbody>
          <tr v-for="event in recentEvents" :key="event.id">
            <td>{{ event.replacedAt }}</td>
            <td>{{ event.manholeCode }}</td>
            <td>{{ event.road }}</td>
            <td>{{ event.manholeType }}</td>
            <td>{{ event.batchId ?? '批次外直接更换' }}</td>
            <td>{{ event.archiveCode }}</td>
            <td>{{ event.operator }}</td>
          </tr>
          <tr v-if="!recentEvents.length">
            <td colspan="7" class="empty-state">暂无井盖更换记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import {
  listReplacementTrajectory,
  manholeMaintenanceStats,
  type ManholeMaintenanceStats,
  type ReplacementTrajectoryItem,
} from '@/api/maintenance'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const maintenance = ref<ManholeMaintenanceStats>({
  total: 0,
  pending: 0,
  inProgress: 0,
  replaced: 0,
  replacedToday: 0,
})
const recentEvents = ref<ReplacementTrajectoryItem[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  maintenance.value = manholeMaintenanceStats()
  recentEvents.value = listReplacementTrajectory().slice(0, 5)
}

onMounted(refresh)
</script>

<style scoped>
.maintenance-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.maintenance-panel h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
</style>
