// 井盖养护批次 / 更换轨迹的端到端验证：直接打包真实源码，在内存 localStorage 上跑。
// 运行：node scripts/test-manhole.mjs
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function makeStorage() {
  let data = new Map()
  const api = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (api.failKeys.has(key)) {
        throw new Error(`注入故障：${key} 写入失败`)
      }
      data.set(key, String(value))
    },
    removeItem: (key) => data.delete(key),
    clear() {
      data = new Map()
    },
    failKeys: new Set(),
  }
  return api
}

const SEED_ENTRIES = {
  manhole: [
    { id: 1, status: '正常', pending: false, abnormal: false, 井盖编号: 'MANH-0001', 所属道路: '人民大道', 井盖类型: '雨水井', 井盖材质: '球墨铸铁', 养护周期: '季度' },
    { id: 2, status: '待维护', pending: true, abnormal: false, 井盖编号: 'MANH-0002', 所属道路: '人民大道', 井盖类型: '雨水井', 井盖材质: '球墨铸铁', 养护周期: '季度' },
    { id: 3, status: '维护中', pending: false, abnormal: false, 井盖编号: 'MANH-0003', 所属道路: '人民大道', 井盖类型: '污水井', 井盖材质: '复合树脂', 养护周期: '月度' },
    { id: 4, status: '正常', pending: false, abnormal: false, 井盖编号: 'MANH-0004', 所属道路: '建设二路', 井盖类型: '雨水井', 井盖材质: '球墨铸铁', 养护周期: '季度' },
    { id: 5, status: '正常', pending: false, abnormal: false, 井盖编号: 'MANH-0005', 所属道路: '建设二路', 井盖类型: '电力井', 井盖材质: '混凝土', 养护周期: '半年' },
  ],
  facility_archive: [
    { id: 1, status: '已归档', pending: false, abnormal: false, 档案编号: 'FACI-0001', 设施名称: '旧档案' },
  ],
}

async function loadService(storage) {
  globalThis.window = { localStorage: storage }
  const dir = mkdtempSync(join(tmpdir(), 'manhole-test-'))
  const entry = join(dir, 'entry.js')
  writeFileSync(entry, "export * from '@/api/manhole-service'\n")
  const outfile = join(dir, 'bundle.js')
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    alias: { '@': join(process.cwd(), 'src') },
  })
  const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${Math.random()}`)
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  return { mod, cleanup }
}

function manholeRows(storage, mod) {
  return JSON.parse(storage.getItem(mod.ENTRIES_KEY)).manhole
}
function archiveRows(storage, mod) {
  return JSON.parse(storage.getItem(mod.ENTRIES_KEY)).facility_archive
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function main() {
  // ========== 环境一：完整业务流程 ==========
  const storage = makeStorage()
  storage.setItem('underground-pipeline-inspection:entries', JSON.stringify(SEED_ENTRIES))
  const { mod, cleanup } = await loadService(storage)
  const {
    createBatch,
    groupedBatchItems,
    saveDraft,
    submitBatch,
    replaceSingleManhole,
    listTracks,
    listBatches,
    getBatch,
    persistManholeFilters,
    loadManholeFilters,
    loadActiveBatchId,
  } = mod

  try {
    console.log('1. 筛选持久化（刷新或重新进入时保留当前筛选）')
    await check('筛选条件写入工作区后可原样读回', () => {
      persistManholeFilters({ 所属道路: '人民大道' })
      assert.deepEqual(loadManholeFilters(), { 所属道路: '人民大道' })
    })

    console.log('2. 新建批次 + 按道路/井盖类型/养护周期分组')
    let batchId
    await check('按当前筛选（人民大道）入批纳入 1、2、3 号，其它道路不进批', () => {
      const res = createBatch({ 所属道路: '人民大道' })
      assert.equal(res.ok, true, res.message)
      batchId = res.batchId
      assert.deepEqual(getBatch(batchId).itemIds.sort(), [1, 2, 3])
    })
    await check('批次内分成 雨水井/季度、污水井/月度 两组', () => {
      const groups = groupedBatchItems(getBatch(batchId))
      assert.equal(groups.length, 2)
      assert.deepEqual(groups.map((g) => `${g.road}/${g.type}/${g.cycle}`), [
        '人民大道/污水井/月度',
        '人民大道/雨水井/季度',
      ])
    })

    console.log('3. 暂存后离开，再回来继续')
    await check('改为只勾选 2 号并暂存；重新读取后勾选与当前批次仍在', () => {
      assert.equal(saveDraft(batchId, [2]).ok, true)
      assert.deepEqual(getBatch(batchId).selectedIds, [2])
      assert.equal(loadActiveBatchId(), batchId)
      assert.equal(listBatches()[0].status, 'draft')
    })

    console.log('4. 确认更换：井盖状态、待更新档案、维护指标同生共死')
    await check('提交后：2 号已更换、档案新增待更新 1 条、轨迹 1 条、批次已提交', () => {
      const res = submitBatch(batchId)
      assert.equal(res.ok, true, res.message)
      const mh2 = manholeRows(storage, mod).find((r) => r.id === 2)
      assert.equal(mh2.status, '已更换')
      assert.equal(mh2.pending, false)
      const archives = archiveRows(storage, mod)
      assert.equal(archives.length, 2)
      const added = archives.find((r) => r.id === 2)
      assert.equal(added.status, '待更新')
      assert.equal(added.pending, true, '待更新档案计入运营概览「待处理」')
      const tracks = listTracks()
      assert.equal(tracks.length, 1)
      assert.equal(tracks[0].manholeId, 2)
      assert.equal(tracks[0].batchId, batchId)
      assert.equal(tracks[0].档案编号, added.档案编号)
      assert.equal(getBatch(batchId).status, 'submitted')
      assert.equal(getBatch(batchId).replacedCount, 1)
    })

    console.log('5. 同一井盖重复提交更换只生效一次')
    await check('已提交批次再次提交被拒绝', () => {
      assert.equal(submitBatch(batchId).ok, false)
    })
    await check('台账对已更换井盖再点「确认更换」被拒绝，档案/轨迹不增加', () => {
      const before = archiveRows(storage, mod).length
      assert.equal(replaceSingleManhole(2).ok, false)
      assert.equal(archiveRows(storage, mod).length, before)
      assert.equal(listTracks().length, 1)
    })

    console.log('6. 第二批纳入全部井盖：已更换的自动跳过，其余只生效一次')
    await check('无筛选入批 4 个（已更换的不进新批），分成 4 组，提交后 4 个完成更换', () => {
      const res = createBatch({})
      assert.equal(res.ok, true, res.message)
      const batchId2 = res.batchId
      assert.deepEqual(getBatch(batchId2).itemIds.sort(), [1, 3, 4, 5])
      const groups = groupedBatchItems(getBatch(batchId2))
      assert.equal(groups.length, 4)
      const submitted = submitBatch(batchId2)
      assert.equal(submitted.ok, true, submitted.message)
      assert.equal(
        manholeRows(storage, mod).filter((r) => r.status === '已更换').length,
        5,
      )
      assert.equal(getBatch(batchId2).replacedCount, 4)
      assert.equal(listTracks().length, 5)
      assert.equal(archiveRows(storage, mod).length, 6, '原 1 条旧档案 + 5 条待更新')
    })

    console.log('7. 不变量复核：轨迹 ↔ 已更换井盖 ↔ 待更新档案一一对应')
    await check('每个井盖至多一条轨迹，且三侧数量一致，无撕裂状态', () => {
      const tracks = listTracks()
      const replacedIds = new Set(
        manholeRows(storage, mod).filter((r) => r.status === '已更换').map((r) => r.id),
      )
      const archiveIds = new Set(archiveRows(storage, mod).map((r) => r.id))
      assert.equal(new Set(tracks.map((t) => t.manholeId)).size, tracks.length)
      for (const track of tracks) {
        assert.ok(replacedIds.has(track.manholeId), `井盖 ${track.manholeId} 应为已更换`)
        assert.ok(archiveIds.has(track.archiveId), `轨迹档案 ${track.archiveId} 应存在`)
        const archive = archiveRows(storage, mod).find((r) => r.id === track.archiveId)
        assert.equal(archive.status, '待更新')
      }
      assert.equal(replacedIds.size, tracks.length)
    })
    cleanup()

    // ========== 环境二：写入故障（部分失败）原子回滚 ==========
    console.log('8. 部分写入失败：井盖与档案两侧必须一致')
    for (const sentinel of ['__fail:workspace', '__fail:entries']) {
      const failStorage = makeStorage()
      failStorage.setItem('underground-pipeline-inspection:entries', JSON.stringify(SEED_ENTRIES))
      // 打开故障注入开关：原子提交在对应键上失败。
      failStorage.setItem(sentinel, '1')
      const env = await loadService(failStorage)
      const m = env.mod
      const beforeText = failStorage.getItem(m.ENTRIES_KEY)
      await check(`${sentinel === '__fail:workspace' ? '工作区键（第二写）' : '条目键（第一写）'}写入失败 → 井盖/档案/轨迹/批次全部不变`, () => {
        const created = m.createBatch({})
        assert.equal(created.ok, true, created.message)
        const res = m.submitBatch(created.batchId)
        assert.equal(res.ok, false)
        assert.match(res.message, /均未改动/)
        // 持久层条目键与故障前逐字节一致
        assert.equal(failStorage.getItem(m.ENTRIES_KEY), beforeText)
        const mh = JSON.parse(failStorage.getItem(m.ENTRIES_KEY)).manhole
        assert.deepEqual(
          mh.map((r) => r.status),
          ['正常', '待维护', '维护中', '正常', '正常'],
        )
        assert.equal(JSON.parse(failStorage.getItem(m.ENTRIES_KEY)).facility_archive.length, 1)
        // 第二写失败时第一写已回滚；工作区也不应留下已提交批次（仍是暂存草稿或干净状态）
        const ws = JSON.parse(failStorage.getItem(m.WORKSPACE_KEY) ?? '{"batches":[]}')
        assert.ok(ws.batches.every((b) => b.status !== 'submitted'))
      })
      env.cleanup()
    }

    await check('第二写失败时第一写被回滚（条目键内容恢复原值），且失败后可重新提交成功', async () => {
      const failStorage = makeStorage()
      failStorage.setItem('underground-pipeline-inspection:entries', JSON.stringify(SEED_ENTRIES))
      failStorage.setItem('__fail:workspace', '1')
      const env = await loadService(failStorage)
      const created = env.mod.createBatch({})
      assert.equal(env.mod.submitBatch(created.batchId).ok, false)
      // 内存缓存未被污染：去掉故障开关后重新提交成功
      failStorage.removeItem('__fail:workspace')
      const retry = env.mod.submitBatch(created.batchId)
      assert.equal(retry.ok, true, retry.message)
      const saved = JSON.parse(failStorage.getItem(env.mod.ENTRIES_KEY))
      assert.equal(saved.manhole.filter((r) => r.status === '已更换').length, 5)
      assert.equal(saved.facility_archive.filter((r) => r.status === '待更新').length, 5)
      env.cleanup()
    })

    console.log(`\n全部通过：${passed} 项断言场景`)
  } catch (error) {
    cleanup()
    throw error
  }
}

main().catch((error) => {
  console.error('\n验证失败：', error)
  process.exit(1)
})
