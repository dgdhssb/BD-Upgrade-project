<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  archiveApi,
  recommendTier,
  analyzeCapacity,
  checkHealth,
  checkBatchResult,
  isTierNoOp,
  tierChangeHint,
  type ArchiveRecord,
  type ArchiveTaskDTO,
  type BackupTask,
  type RestoreTask,
  type BatchArchiveResult,
  type DataType,
  type StorageTier,
  type TaskStatus,
  type TierStat,
  type DataTypeStat,
} from '@/api/modules/archive'

import ConnectionStatus from '@/components/ConnectionStatus.vue'

// ============ Tab ============
const activeTab = ref('records')
const tabs = [
  { key: 'records', label: '📦 归档记录' },
  { key: 'backups', label: '💾 备份任务' },
  { key: 'restores', label: '🔙 恢复任务' },
  { key: 'ai', label: '🤖 智能分析' },
]

// ============ 状态 ============
const live = ref(false)
const loading = ref(false)
const toastMsg = ref('')
const diagError = ref('')
const toast = (m: string) => { toastMsg.value = m; setTimeout(() => (toastMsg.value = ''), 2500) }

// —— 通用详情钻取（复用 getRecord / getBackup / getRestore 三个按 id 查询接口）——
const detail = ref<{ title: string; json: string } | null>(null)
async function showDetail(title: string, fn: () => Promise<{ data: unknown }>) {
  try {
    const r = await fn()
    detail.value = { title, json: JSON.stringify(r.data, null, 2) }
  } catch (e) {
    toast(`详情拉取失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

const records = ref<ArchiveRecord[]>([])
const recordTotal = ref(0)
const recordPage = ref(1)
const recordSize = ref(10)
const backups = ref<BackupTask[]>([])
const backupTotal = ref(0)
const backupPage = ref(1)
const backupSize = ref(10)
const restores = ref<RestoreTask[]>([])
const restoreTotal = ref(0)
const restorePage = ref(1)
const restoreSize = ref(10)
const tierStats = ref<TierStat[]>([])
const dataTypeStats = ref<DataTypeStat[]>([])

// 筛选（dataType 后端必填，默认 RAW）
const filterDataType = ref<DataType>('RAW')
const filterStatus = ref<TaskStatus | ''>('')
const filterBackupType = ref('')
const filterBackupStatus = ref<TaskStatus | ''>('')
const filterRestoreStatus = ref<TaskStatus | ''>('')

async function loadRecords() {
  try {
    const res = await archiveApi.listRecords({
      dataType: filterDataType.value,
      status: filterStatus.value || undefined,
      page: recordPage.value,
      size: recordSize.value,
    })
    records.value = res.data.records
    recordTotal.value = res.data.total
    live.value = res.live
  } catch (e) {
    records.value = []
    recordTotal.value = 0
    throw e
  }
}

async function loadBackups() {
  try {
    const res = await archiveApi.listBackups({
      backupType: filterBackupType.value || undefined,
      status: filterBackupStatus.value || undefined,
      page: backupPage.value,
      size: backupSize.value,
    })
    backups.value = res.data.records
    backupTotal.value = res.data.total
    live.value = res.live || live.value
  } catch (e) {
    backups.value = []
    backupTotal.value = 0
    throw e
  }
}

async function loadRestores() {
  try {
    const res = await archiveApi.listRestores({
      status: filterRestoreStatus.value || undefined,
      page: restorePage.value,
      size: restoreSize.value,
    })
    restores.value = res.data.records
    restoreTotal.value = res.data.total
    live.value = res.live || live.value
  } catch (e) {
    restores.value = []
    restoreTotal.value = 0
    throw e
  }
}

/**
 * 一次性拉全量并聚合两套统计（旧做法是 tierStats / dataTypeStats 各扫一遍，请求翻倍）。
 * 单个 dataType 失败不阻断整体，但错误会透出到 diagError —— 纯真实模式不静默吞错。
 */
async function loadStats() {
  const r = await archiveApi.allStats()
  tierStats.value = r.data.tierStats
  dataTypeStats.value = r.data.dataTypeStats
  if (r.errors.length) {
    diagError.value = `统计部分失败：${r.errors.join(' ｜ ')}`
  }
}

async function loadAll() {
  loading.value = true
  try {
    await loadRecords()
    await loadBackups()
    await loadRestores()
    await loadStats()
    diagError.value = ''
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    diagError.value = `后端连接失败：${msg}`
    live.value = false
  } finally { loading.value = false }
}

onMounted(() => { loadAll(); timer = window.setInterval(loadAll, 30000) })
let timer = 0
onUnmounted(() => clearInterval(timer))

// ============ KPI ============
const kpiCards = computed(() => {
  const totalRecords = recordTotal.value
  const hotCount = tierStats.value.find((t) => t.tier === 'HOT')?.count || 0
  const nearCount = tierStats.value.find((t) => t.tier === 'NEARLINE')?.count || 0
  const coldCount = tierStats.value.find((t) => t.tier === 'COLD')?.count || 0
  const pendingBackups = backups.value.filter((b) => b.status === 'PENDING' || b.status === 'PROCESSING').length
  const pendingRestores = restores.value.filter((r) => r.status === 'PENDING' || r.status === 'PROCESSING').length

  return [
    { label: '归档总数', value: totalRecords.toLocaleString(), target: '条记录', ok: true, icon: '📦', color: '#1890ff' },
    { label: 'HOT 存储', value: hotCount.toLocaleString(), target: '热数据', ok: hotCount < 100, icon: '🔥', color: hotCount >= 100 ? '#faad14' : '#ff4d4f' },
    { label: 'NEARLINE', value: nearCount.toLocaleString(), target: '近线数据', ok: true, icon: '📂', color: '#13c2c2' },
    { label: 'COLD 归档', value: coldCount.toLocaleString(), target: '冷数据', ok: true, icon: '🧊', color: '#722ed1' },
    { label: '备份进行', value: pendingBackups.toString(), target: `恢复 ${pendingRestores}`, ok: pendingBackups < 5, icon: '💾', color: pendingBackups >= 5 ? '#ff4d4f' : '#52c41a' },
  ]
})

// ============ 归档记录操作 ============
async function changeTier(r: ArchiveRecord, tier: StorageTier) {
  // FIELD 表没有 storage_tier 列，后端返回成功但数据不变 —— 必须先告知用户，
  // 否则用户会以为降级成功了（接口文档 §2 已知坑点）
  if (isTierNoOp(r.dataType)) {
    if (!window.confirm(`${tierChangeHint(r.dataType, tier)}\n\n仍要继续发送该请求吗？`)) return
  }
  try {
    await archiveApi.updateTier(r.dataType, r.id, tier)
    // FIELD 是空操作，不假装本地状态已变更
    if (!isTierNoOp(r.dataType)) {
      r.storageTier = tier
      toast(`归档 ${r.id} 已变更为 ${tier}`)
    } else {
      toast(`请求已发送，但 FIELD 数据的分级不会被真正修改（后端无该列）`)
    }
    await loadStats()
  } catch (e) {
    toast(`存储分级变更失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function downloadRecord(r: ArchiveRecord) {
  try {
    const res = await archiveApi.downloadInfo(r.dataType, r.id)
    toast(`下载链接: ${res.data.url}（有效期至 ${res.data.expireTime}）`)
  } catch (e) {
    toast(`获取下载链接失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

const showCreateRecord = ref(false)
const newRecord = ref<Partial<ArchiveRecord>>({ dataType: 'RAW', storageTier: 'HOT', filePath: '', fileName: '', fileSize: 0, checksum: '' })
/**
 * 按 dataType 校验必填字段（接口文档 §2 创建归档说明）
 *   RAW   ：stationId 必填，epochStart/epochEnd 用毫秒时间戳
 *   DIFF  ：stationId 必填，validStart/validEnd 必填且为 ISO-8601
 *   FIELD ：taskId / collectorId / collectorName / 经纬度，且忽略 storageTier
 * 提前在本地拦截，比等后端返回 10001 PARAM_ERROR 更省事。
 */
function validateRecord(v: Partial<ArchiveRecord>): string | null {
  const dt = v.dataType
  if (!dt) return '请选择数据类型'
  if (!v.filePath?.trim()) return 'filePath 必填'
  if (!v.fileName?.trim()) return 'fileName 必填'
  if (!v.fileSize || v.fileSize <= 0) return 'fileSize 必须是正整数'
  if (!v.checksum?.trim()) return 'checksum 必填'

  if (dt === 'RAW' || dt === 'DIFF') {
    if (!v.stationId?.trim()) return `${dt} 数据 stationId 必填`
  }
  if (dt === 'DIFF') {
    if (!v.validStart?.trim() || !v.validEnd?.trim()) return 'DIFF 数据 validStart / validEnd 必填（ISO-8601）'
    if (Number.isNaN(new Date(v.validStart).getTime()) || Number.isNaN(new Date(v.validEnd).getTime())) {
      return 'DIFF 的 validStart / validEnd 必须是合法 ISO-8601 时间'
    }
  }
  if (dt === 'RAW') {
    if (v.epochStart !== undefined && v.epochEnd !== undefined && v.epochEnd < v.epochStart) {
      return 'RAW 的 epochEnd 不能早于 epochStart（毫秒时间戳）'
    }
  }
  if (dt === 'FIELD') {
    if (!v.taskId?.trim()) return 'FIELD 数据 taskId 必填'
    if (!v.collectorId?.trim()) return 'FIELD 数据 collectorId 必填'
    if (v.longitude === undefined || v.latitude === undefined) return 'FIELD 数据经纬度必填'
    if (v.longitude < -180 || v.longitude > 180) return '经度必须在 -180 ~ 180 之间'
    if (v.latitude < -90 || v.latitude > 90) return '纬度必须在 -90 ~ 90 之间'
  }
  return null
}

async function createRecord() {
  const v = newRecord.value
  const err = validateRecord(v)
  if (err) {
    toast(err)
    return
  }
  // 上面已经校验过，这里 TS 可以安全收窄
  const dto: ArchiveTaskDTO = {
    dataType: v.dataType!,
    filePath: v.filePath!.trim(),
    fileName: v.fileName!.trim(),
    fileSize: v.fileSize!,
    checksum: v.checksum!.trim(),
    ...(v.storageTier ? { storageTier: v.storageTier } : {}),
    ...(v.stationId?.trim() ? { stationId: v.stationId.trim() } : {}),
    ...(v.taskId?.trim() ? { taskId: v.taskId.trim() } : {}),
    ...(v.collectorId?.trim() ? { collectorId: v.collectorId.trim() } : {}),
    ...(v.collectorName?.trim() ? { collectorName: v.collectorName.trim() } : {}),
    ...(v.epochStart !== undefined ? { epochStart: v.epochStart } : {}),
    ...(v.epochEnd !== undefined ? { epochEnd: v.epochEnd } : {}),
    ...(v.validStart?.trim() ? { validStart: v.validStart.trim() } : {}),
    ...(v.validEnd?.trim() ? { validEnd: v.validEnd.trim() } : {}),
    ...(v.longitude !== undefined ? { longitude: v.longitude } : {}),
    ...(v.latitude !== undefined ? { latitude: v.latitude } : {}),
    ...(v.altitude !== undefined ? { altitude: v.altitude } : {}),
  }
  try {
    const res = await archiveApi.createRecord(dto)
    records.value.unshift(res.data)
    recordTotal.value++
    showCreateRecord.value = false
    toast('归档记录已创建，后端会自动触发元数据入库')
    await loadStats()
  } catch (e) {
    toast(`创建失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============ 批量归档（接口文档 #6 POST /archive/batch）============
// 后端语义：数组里某条 dataType 非法会被跳过，但整体仍返回成功，
// 所以不能只看「没报错」，必须用 checkBatchResult 比对 archiveIds 数与入参数。
const showBatchDialog = ref(false)
const batchJson = ref('')
const batchResult = ref<ReturnType<typeof checkBatchResult> | null>(null)

function openBatchDialog() {
  batchResult.value = null
  // 请求体模板（不是演示数据：只是给一个可直接改的合法 JSON 骨架）
  batchJson.value = JSON.stringify(
    [
      {
        dataType: 'RAW',
        stationId: '',
        filePath: '',
        fileName: '',
        fileSize: 0,
        checksum: '',
        storageTier: 'HOT',
      },
    ],
    null,
    2,
  )
  showBatchDialog.value = true
}

async function submitBatch() {
  let list: unknown
  try {
    list = JSON.parse(batchJson.value)
  } catch {
    toast('JSON 格式错误，请检查后重试')
    return
  }
  if (!Array.isArray(list) || list.length === 0) {
    toast('批量归档请求体必须是非空数组')
    return
  }
  const invalid = (list as ArchiveTaskDTO[]).findIndex(
    (d) => !d || !['RAW', 'DIFF', 'FIELD'].includes(d.dataType),
  )
  if (invalid >= 0) {
    toast(`第 ${invalid + 1} 条的 dataType 非法（只能是 RAW / DIFF / FIELD），会被后端跳过`)
  }
  try {
    const res = await archiveApi.batchArchive(list as ArchiveTaskDTO[])
    batchResult.value = checkBatchResult(list.length, res.data)
    toast(batchResult.value.message)
    await loadRecords()
    await loadStats()
  } catch (e) {
    toast(`批量归档失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============ 备份任务操作 ============
const showCreateBackup = ref(false)
const newBackup = ref<Partial<BackupTask>>({ backupType: 'FULL', targetType: 'PG', sourcePath: '/data', destPath: '/backup' })
async function createBackup() {
  if (!newBackup.value.backupType || !newBackup.value.targetType || !newBackup.value.sourcePath || !newBackup.value.destPath) {
    toast('请填写必填字段'); return
  }
  try {
    const res = await archiveApi.createBackup(newBackup.value)
    backups.value.unshift(res.data)
    backupTotal.value++
    showCreateBackup.value = false
    toast('备份任务已创建')
  } catch (e) {
    toast(`创建失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function updateBackupStatus(b: BackupTask, status: TaskStatus) {
  try {
    await archiveApi.updateBackupStatus(b.id, { status })
    b.status = status
    toast(`备份 ${b.id} 状态已更新为 ${status}`)
  } catch (e) {
    toast(`状态更新失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============ 恢复任务操作 ============
async function updateRestoreStatus(r: RestoreTask, status: TaskStatus) {
  try {
    await archiveApi.updateRestoreStatus(r.id, { status })
    r.status = status
    toast(`恢复 ${r.id} 状态已更新为 ${status}`)
  } catch (e) {
    toast(`状态更新失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// 派生恢复任务：目标路径必须由用户填，不允许伪造
// （旧实现硬编码 archiveId:'arc-001' + targetPath:`/restore/${id}`，属于演示数据，已移除）
const showRestoreDialog = ref(false)
const restoreTarget = ref<BackupTask | null>(null)
const restoreForm = ref({ targetPath: '', restorePoint: '' })

function openRestoreDialog(b: BackupTask) {
  restoreTarget.value = b
  restoreForm.value = { targetPath: '', restorePoint: '' }
  showRestoreDialog.value = true
}

async function submitRestore() {
  const b = restoreTarget.value
  if (!b) return
  const targetPath = restoreForm.value.targetPath.trim()
  if (!targetPath) {
    toast('请填写恢复目标路径')
    return
  }
  try {
    // 注意：后端忽略请求体里的 archiveId，只认路径上的备份任务 id（接口文档 §2）
    const res = await archiveApi.restoreFromBackup(b.id, {
      targetPath,
      restorePoint: restoreForm.value.restorePoint.trim() || undefined,
    })
    restores.value.unshift(res.data)
    restoreTotal.value++
    showRestoreDialog.value = false
    restoreTarget.value = null
    toast('恢复任务已派生')
  } catch (e) {
    toast(`恢复任务派生失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============ 智能分析 ============
const selectedRecordForAI = ref<ArchiveRecord | null>(null)
const aiTierAdvice = computed(() => selectedRecordForAI.value ? recommendTier(selectedRecordForAI.value) : null)
const capacityAnalysis = computed(() => analyzeCapacity(tierStats.value, dataTypeStats.value))
const healthIssues = computed(() => checkHealth(records.value))

const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size))

const tierBadge = (tier: StorageTier) => {
  const map: Record<string, { bg: string; color: string }> = {
    HOT: { bg: '#fff1f0', color: '#ff4d4f' },
    NEARLINE: { bg: '#fff7e6', color: '#faad14' },
    COLD: { bg: '#e6f7ff', color: '#1890ff' },
  }
  return map[tier] || { bg: '#f5f5f5', color: '#888' }
}

const statusBadge = (status: TaskStatus) => {
  const map: Record<string, { bg: string; color: string }> = {
    PENDING: { bg: '#fff7e6', color: '#faad14' },
    PROCESSING: { bg: '#e6f7ff', color: '#1890ff' },
    SUCCESS: { bg: '#f6ffed', color: '#52c41a' },
    FAILED: { bg: '#fff1f0', color: '#ff4d4f' },
  }
  return map[status] || { bg: '#f5f5f5', color: '#888' }
}

const formatSize = (bytes: number) => {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB'
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}
</script>

<template>
  <div class="module-view">
    <!-- health-path 走 /api/v1/archive/health，由 vite 代理 rewrite 成后端根路径 /health
         （接口文档 §2 第 15 条：健康检查是 GET /health，不在 /api/v1/archive 前缀下） -->
    <ConnectionStatus service-name="归档服务（MS-10）" :port="18090" health-path="/api/v1/archive/health" mode="real" />
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">📦 归档管理 · 智能监控</h1>
        <span class="sr-tag">MS-10 ｜ archive-service</span>
        <span class="mode-badge" :class="{ live, demo: !live }"><i class="mode-dot"></i>{{ live ? '真实后端' : '后端未连接' }}</span>
        <span v-if="diagError" class="diag-badge" :title="diagError">⚠ {{ diagError }}</span>
      </div>
      <div class="header-right">
        <button class="btn-sm outline" @click="loadAll" :disabled="loading">{{ loading ? '⏳' : '🔄 刷新' }}</button>
        <span class="poll-tip">每 30s 轮询</span>
      </div>
    </div>

    <div class="kpi-row">
      <div v-for="(k, idx) in kpiCards" :key="idx" class="kpi-card" :class="{ warn: !k.ok }">
        <div class="kpi-icon" :style="{ color: k.color }">{{ k.icon }}</div>
        <div class="kpi-info">
          <div class="kpi-value" :style="{ color: k.ok ? k.color : '#ff4d4f' }">{{ k.value }}</div>
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-target">{{ k.target }}</div>
        </div>
      </div>
    </div>

    <div class="tab-bar">
      <span v-for="t in tabs" :key="t.key" class="tab" :class="{ active: activeTab === t.key }" @click="activeTab = t.key">{{ t.label }}</span>
    </div>

    <!-- ===== Tab1 归档记录 ===== -->
    <div v-show="activeTab === 'records'" class="tab-content">
      <div class="panel">
        <div class="panel-header-row">
          <div class="panel-title">📦 归档记录 <span class="count-tag">{{ recordTotal }} 条</span></div>
          <div class="panel-actions">
            <select v-model="filterDataType" @change="recordPage = 1; loadRecords()" class="form-select" style="width:140px">
              <option value="RAW">RAW 原始数据</option>
              <option value="DIFF">DIFF 差分数据</option>
              <option value="FIELD">FIELD 外业数据</option>
            </select>
            <select v-model="filterStatus" @change="recordPage = 1; loadRecords()" class="form-select" style="width:120px">
              <option value="">全部状态</option>
              <option value="PENDING">PENDING</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
            <button class="btn-sm outline" @click="openBatchDialog">📦 批量归档</button>
            <button class="btn-primary" @click="showCreateRecord = true">➕ 新增归档</button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>ID</th><th>类型</th><th>站点/任务</th><th>文件名</th><th>大小</th><th>存储分级</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td class="td-primary">{{ r.id }}</td>
              <td><span class="tier-tag" :style="{ background: r.dataType === 'RAW' ? '#e6f7ff' : r.dataType === 'DIFF' ? '#f6ffed' : '#fff7e6', color: r.dataType === 'RAW' ? '#1890ff' : r.dataType === 'DIFF' ? '#52c41a' : '#faad14' }">{{ r.dataType }}</span></td>
              <td>{{ r.stationId || r.taskId || '-' }}</td>
              <td>{{ r.fileName }}</td>
              <td>{{ formatSize(r.fileSize) }}</td>
              <td>
                <span class="tier-tag" :style="{ background: tierBadge(r.storageTier).bg, color: tierBadge(r.storageTier).color }">{{ r.storageTier }}</span>
              </td>
              <td>
                <span class="tier-tag" :style="{ background: statusBadge(r.status).bg, color: statusBadge(r.status).color }">{{ r.status }}</span>
              </td>
              <td>{{ r.createTime }}</td>
              <td>
                <button class="btn-sm outline" @click="changeTier(r, 'HOT')" :disabled="r.storageTier === 'HOT'">🔥 HOT</button>
                <button class="btn-sm outline" @click="changeTier(r, 'NEARLINE')" :disabled="r.storageTier === 'NEARLINE'">📂 NEARLINE</button>
                <button class="btn-sm outline" @click="changeTier(r, 'COLD')" :disabled="r.storageTier === 'COLD'">🧊 COLD</button>
                <button class="btn-sm outline primary" @click="downloadRecord(r)">⬇ 下载</button>
                <button class="btn-sm outline" @click="showDetail(`归档记录详情 · ${r.id}`, () => archiveApi.getRecord(r.dataType, r.id))">🔍 详情</button>
                <button class="btn-sm outline" @click="selectedRecordForAI = r; activeTab = 'ai'">🤖 AI</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pagination" v-if="recordTotal > recordSize">
          <button class="btn-sm outline" @click="recordPage > 1 ? (recordPage--, loadRecords()) : null" :disabled="recordPage <= 1">上一页</button>
          <span class="page-info">第 {{ recordPage }} / {{ pageCount(recordTotal, recordSize) }} 页</span>
          <button class="btn-sm outline" @click="recordPage < pageCount(recordTotal, recordSize) ? (recordPage++, loadRecords()) : null" :disabled="recordPage >= pageCount(recordTotal, recordSize)">下一页</button>
        </div>
      </div>

      <div class="content-grid two">
        <div class="panel">
          <div class="panel-title">🥧 存储分级分布</div>
          <div class="dist-list">
            <div v-for="t in tierStats" :key="t.tier" class="dist-row">
              <span class="dist-name">{{ t.tier }}</span>
              <div class="dist-bar"><i :style="{ width: Math.max(5, (t.count / Math.max(1, tierStats.reduce((s, x) => s + x.count, 0)) * 100)) + '%', background: t.tier === 'HOT' ? 'linear-gradient(90deg, #ff7875, #ff4d4f)' : t.tier === 'NEARLINE' ? 'linear-gradient(90deg, #ffd666, #faad14)' : 'linear-gradient(90deg, #69c0ff, #1890ff)' }"></i></div>
              <span class="dist-num">{{ t.count }} 条 ({{ formatSize(t.totalSize) }})</span>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">📊 数据类型分布</div>
          <div class="dist-list">
            <div v-for="d in dataTypeStats" :key="d.dataType" class="dist-row">
              <span class="dist-name">{{ d.dataType }}</span>
              <div class="dist-bar"><i :style="{ width: Math.max(5, (d.count / Math.max(1, dataTypeStats.reduce((s, x) => s + x.count, 0)) * 100)) + '%' }"></i></div>
              <span class="dist-num">{{ d.count }} 条 ({{ formatSize(d.totalSize) }})</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Tab2 备份任务 ===== -->
    <div v-show="activeTab === 'backups'" class="tab-content">
      <div class="panel">
        <div class="panel-header-row">
          <div class="panel-title">💾 备份任务 <span class="count-tag">{{ backupTotal }} 条</span></div>
          <div class="panel-actions">
            <select v-model="filterBackupType" @change="backupPage = 1; loadBackups()" class="form-select" style="width:120px">
              <option value="">全部类型</option>
              <option value="FULL">FULL</option>
              <option value="INCREMENTAL">INCREMENTAL</option>
            </select>
            <select v-model="filterBackupStatus" @change="backupPage = 1; loadBackups()" class="form-select" style="width:120px">
              <option value="">全部状态</option>
              <option value="PENDING">PENDING</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
            <button class="btn-primary" @click="showCreateBackup = true">➕ 创建备份</button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>ID</th><th>类型</th><th>目标</th><th>源路径</th><th>目标路径</th><th>文件数</th><th>大小</th><th>状态</th><th>耗时</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in backups" :key="b.id">
              <td class="td-primary">{{ b.id }}</td>
              <td>{{ b.backupType }}</td>
              <td>{{ b.targetType }}</td>
              <td>{{ b.sourcePath }}</td>
              <td>{{ b.destPath }}</td>
              <td>{{ b.fileCount }}</td>
              <td>{{ formatSize(b.totalSize) }}</td>
              <td>
                <span class="tier-tag" :style="{ background: statusBadge(b.status).bg, color: statusBadge(b.status).color }">{{ b.status }}</span>
                <div v-if="b.errorMsg" class="err-msg">{{ b.errorMsg }}</div>
              </td>
              <td>{{ b.startTime && b.endTime ? Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000) + ' min' : '-' }}</td>
              <td>
                <button class="btn-sm outline" @click="updateBackupStatus(b, 'PROCESSING')" :disabled="b.status === 'PROCESSING' || b.status === 'SUCCESS'">▶ 执行</button>
                <button class="btn-sm outline" @click="updateBackupStatus(b, 'SUCCESS')" :disabled="b.status === 'SUCCESS'">✅ 完成</button>
                <button class="btn-sm outline danger" @click="updateBackupStatus(b, 'FAILED')" :disabled="b.status === 'FAILED'">❌ 失败</button>
                <button class="btn-sm outline primary" @click="openRestoreDialog(b)">🔙 恢复</button>
                <button class="btn-sm outline" @click="showDetail(`备份任务详情 · ${b.id}`, () => archiveApi.getBackup(b.id))">🔍 详情</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pagination" v-if="backupTotal > backupSize">
          <button class="btn-sm outline" @click="backupPage > 1 ? (backupPage--, loadBackups()) : null" :disabled="backupPage <= 1">上一页</button>
          <span class="page-info">第 {{ backupPage }} / {{ pageCount(backupTotal, backupSize) }} 页</span>
          <button class="btn-sm outline" @click="backupPage < pageCount(backupTotal, backupSize) ? (backupPage++, loadBackups()) : null" :disabled="backupPage >= pageCount(backupTotal, backupSize)">下一页</button>
        </div>
      </div>
    </div>

    <!-- ===== Tab3 恢复任务 ===== -->
    <div v-show="activeTab === 'restores'" class="tab-content">
      <div class="panel">
        <div class="panel-header-row">
          <div class="panel-title">🔙 恢复任务 <span class="count-tag">{{ restoreTotal }} 条</span></div>
          <div class="panel-actions">
            <select v-model="filterRestoreStatus" @change="restorePage = 1; loadRestores()" class="form-select" style="width:120px">
              <option value="">全部状态</option>
              <option value="PENDING">PENDING</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>ID</th><th>关联备份</th><th>恢复点</th><th>目标路径</th><th>状态</th><th>耗时</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in restores" :key="r.id">
              <td class="td-primary">{{ r.id }}</td>
              <td>{{ r.backupTaskId }}</td>
              <td>{{ r.restorePoint || '最新' }}</td>
              <td>{{ r.targetPath }}</td>
              <td>
                <span class="tier-tag" :style="{ background: statusBadge(r.status).bg, color: statusBadge(r.status).color }">{{ r.status }}</span>
                <div v-if="r.errorMsg" class="err-msg">{{ r.errorMsg }}</div>
              </td>
              <td>{{ r.startTime && r.endTime ? Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000) + ' min' : '-' }}</td>
              <td>
                <button class="btn-sm outline" @click="updateRestoreStatus(r, 'PROCESSING')" :disabled="r.status === 'PROCESSING' || r.status === 'SUCCESS'">▶ 执行</button>
                <button class="btn-sm outline" @click="updateRestoreStatus(r, 'SUCCESS')" :disabled="r.status === 'SUCCESS'">✅ 完成</button>
                <button class="btn-sm outline danger" @click="updateRestoreStatus(r, 'FAILED')" :disabled="r.status === 'FAILED'">❌ 失败</button>
                <button class="btn-sm outline" @click="showDetail(`恢复任务详情 · ${r.id}`, () => archiveApi.getRestore(r.id))">🔍 详情</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pagination" v-if="restoreTotal > restoreSize">
          <button class="btn-sm outline" @click="restorePage > 1 ? (restorePage--, loadRestores()) : null" :disabled="restorePage <= 1">上一页</button>
          <span class="page-info">第 {{ restorePage }} / {{ pageCount(restoreTotal, restoreSize) }} 页</span>
          <button class="btn-sm outline" @click="restorePage < pageCount(restoreTotal, restoreSize) ? (restorePage++, loadRestores()) : null" :disabled="restorePage >= pageCount(restoreTotal, restoreSize)">下一页</button>
        </div>
      </div>
    </div>

    <!-- ===== Tab4 智能分析 ===== -->
    <div v-show="activeTab === 'ai'" class="tab-content">
      <div class="content-grid two">
        <div class="panel">
          <div class="panel-title">🤖 存储分级智能建议</div>
          <div v-if="!selectedRecordForAI" class="empty-state">
            <div class="empty-icon">🤖</div>
            <div class="empty-text">请在「归档记录」页点击某行右侧的 🤖 按钮，选择一条记录进行 AI 分析。</div>
          </div>
          <div v-else class="advice-box">
            <div class="advice-row">
              <div class="advice-label">选中记录</div>
              <div class="advice-text">{{ selectedRecordForAI.id }} ｜ {{ selectedRecordForAI.dataType }} ｜ {{ selectedRecordForAI.fileName }} ｜ {{ formatSize(selectedRecordForAI.fileSize) }}</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">当前分级</div>
              <div class="advice-text"><span class="tier-tag" :style="{ background: tierBadge(selectedRecordForAI.storageTier).bg, color: tierBadge(selectedRecordForAI.storageTier).color }">{{ selectedRecordForAI.storageTier }}</span></div>
            </div>
            <div class="advice-row">
              <div class="advice-label">AI 建议</div>
              <div class="advice-text"><span class="tier-tag" :style="{ background: tierBadge(aiTierAdvice!.recommended).bg, color: tierBadge(aiTierAdvice!.recommended).color }">{{ aiTierAdvice!.recommended }}</span></div>
            </div>
            <div class="advice-row">
              <div class="advice-label">理由</div>
              <div class="advice-text">{{ aiTierAdvice!.reason }}</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">行动</div>
              <div class="advice-text">{{ aiTierAdvice!.action }}</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">节省估算</div>
              <div class="advice-text">{{ aiTierAdvice!.savingsEstimate }}</div>
            </div>
            <div class="ai-actions">
              <button class="btn-primary" @click="changeTier(selectedRecordForAI, aiTierAdvice!.recommended); selectedRecordForAI = null">应用建议分级</button>
              <button class="btn-default" @click="selectedRecordForAI = null">关闭</button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">📊 容量趋势分析</div>
          <div class="advice-box">
            <div class="advice-row">
              <div class="advice-label">总容量</div>
              <div class="advice-text">{{ capacityAnalysis.totalSizeGB }} GB</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">HOT 占比</div>
              <div class="advice-text">{{ capacityAnalysis.hotPercent }}%</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">增长趋势</div>
              <div class="advice-text">{{ capacityAnalysis.growthRate }}</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">诊断</div>
              <div class="advice-text">{{ capacityAnalysis.suggestion }}</div>
            </div>
            <div class="advice-row">
              <div class="advice-label">建议</div>
              <div class="advice-text">{{ capacityAnalysis.action }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">🏥 归档健康度检查</div>
        <div class="analysis-list">
          <div v-for="(h, idx) in healthIssues" :key="idx" class="analysis-card" :class="h.severity">
            <div class="an-head">
              <div class="an-cat">{{ h.issue }}</div>
              <div class="an-count" v-if="h.count > 0">{{ h.count }} 项</div>
              <div class="an-sev" :class="h.severity">{{ h.severity === 'high' ? '高危' : h.severity === 'medium' ? '中危' : '正常' }}</div>
            </div>
            <div class="an-suggestion">
              <div class="an-label">建议</div>
              <div class="an-text">{{ h.advice }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建归档弹窗 -->
    <div v-if="showCreateRecord" class="modal-mask" @click.self="showCreateRecord = false">
      <div class="modal-box">
        <div class="modal-header">➕ 新增归档记录 <span class="modal-close" @click="showCreateRecord = false">✕</span></div>
        <div class="modal-body">
          <div class="ai-form">
            <div class="form-row"><label>数据类型</label><select v-model="newRecord.dataType" class="form-select"><option value="RAW">RAW</option><option value="DIFF">DIFF</option><option value="FIELD">FIELD</option></select></div>
            <div class="form-row"><label>文件路径</label><input v-model="newRecord.filePath" class="form-input" placeholder="/archive/..." /></div>
            <div class="form-row"><label>文件名</label><input v-model="newRecord.fileName" class="form-input" placeholder="xxx.dat" /></div>
            <div class="form-row"><label>文件大小</label><input v-model.number="newRecord.fileSize" type="number" class="form-input" placeholder="字节" /></div>
            <div class="form-row"><label>校验和</label><input v-model="newRecord.checksum" class="form-input" placeholder="MD5/SHA256" /></div>
            <div class="form-row"><label>存储分级</label><select v-model="newRecord.storageTier" class="form-select"><option value="HOT">HOT</option><option value="NEARLINE">NEARLINE</option><option value="COLD">COLD</option></select></div>
            <div class="form-row" v-if="newRecord.dataType === 'RAW' || newRecord.dataType === 'DIFF'"><label>站点ID</label><input v-model="newRecord.stationId" class="form-input" placeholder="ST-001" /></div>
            <div class="form-row" v-if="newRecord.dataType === 'FIELD'"><label>任务ID</label><input v-model="newRecord.taskId" class="form-input" placeholder="field-001" /></div>
            <div class="form-row" v-if="newRecord.dataType === 'FIELD'"><label>采集人</label><input v-model="newRecord.collectorName" class="form-input" placeholder="姓名" /></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-default" @click="showCreateRecord = false">取消</button>
          <button class="btn-primary" @click="createRecord">确定</button>
        </div>
      </div>
    </div>

    <!-- 创建备份弹窗 -->
    <div v-if="showCreateBackup" class="modal-mask" @click.self="showCreateBackup = false">
      <div class="modal-box">
        <div class="modal-header">💾 创建备份任务 <span class="modal-close" @click="showCreateBackup = false">✕</span></div>
        <div class="modal-body">
          <div class="ai-form">
            <div class="form-row"><label>备份类型</label><select v-model="newBackup.backupType" class="form-select"><option value="FULL">FULL</option><option value="INCREMENTAL">INCREMENTAL</option></select></div>
            <div class="form-row"><label>目标类型</label><select v-model="newBackup.targetType" class="form-select"><option value="PG">PG</option><option value="S3">S3</option></select></div>
            <div class="form-row"><label>源路径</label><input v-model="newBackup.sourcePath" class="form-input" placeholder="/data/raw" /></div>
            <div class="form-row"><label>目标路径</label><input v-model="newBackup.destPath" class="form-input" placeholder="/backup/2026" /></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-default" @click="showCreateBackup = false">取消</button>
          <button class="btn-primary" @click="createBackup">确定</button>
        </div>
      </div>
    </div>

    <!-- 派生恢复任务弹窗 -->
    <!-- 注意：后端忽略请求体里的 archiveId，只认路径上的备份任务 id（接口文档 §2 已知坑点） -->
    <div v-if="showRestoreDialog" class="modal-mask" @click.self="showRestoreDialog = false">
      <div class="modal-box">
        <div class="modal-header">🔙 从备份派生恢复任务 <span class="modal-close" @click="showRestoreDialog = false">✕</span></div>
        <div class="modal-body">
          <div class="ai-form">
            <div class="form-row">
              <label>源备份任务</label>
              <input class="form-input" :value="restoreTarget ? `${restoreTarget.id}（${restoreTarget.backupType} / ${restoreTarget.targetType}）` : ''" disabled />
            </div>
            <div class="form-row">
              <label>恢复目标路径</label>
              <input v-model="restoreForm.targetPath" class="form-input" placeholder="/restore/2026-08" />
            </div>
            <div class="form-row">
              <label>恢复点（可选）</label>
              <input v-model="restoreForm.restorePoint" class="form-input" placeholder="留空 = 恢复到最新" />
            </div>
          </div>
          <div class="real-warn">⚠️ 这会真实派生一条恢复任务写入后端，不是预演。</div>
        </div>
        <div class="modal-footer">
          <button class="btn-default" @click="showRestoreDialog = false">取消</button>
          <button class="btn-primary" @click="submitRestore">确定派生</button>
        </div>
      </div>
    </div>

    <!-- 批量归档弹窗（接口文档 #6） -->
    <div v-if="showBatchDialog" class="modal-mask" @click.self="showBatchDialog = false">
      <div class="modal-box" style="width: 620px">
        <div class="modal-header">📦 批量归档 <span class="modal-close" @click="showBatchDialog = false">✕</span></div>
        <div class="modal-body">
          <div class="batch-tip">
            请求体为 <b>裸数组</b>，每项一条归档记录。dataType 只能是 <code>RAW</code> / <code>DIFF</code> / <code>FIELD</code>。
          </div>
          <textarea v-model="batchJson" class="batch-textarea" rows="14" spellcheck="false"></textarea>
          <div v-if="batchResult" class="batch-result" :class="{ warn: !batchResult.ok }">
            {{ batchResult.message }}
          </div>
          <div class="real-warn">
            ⚠️ 后端对批量归档采用<b>部分成功</b>语义：某条 dataType 非法会被跳过，但整体仍返回成功。
            提交后会比对返回的 archiveIds 数与入参数，不一致会明确提示。
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-default" @click="showBatchDialog = false">关闭</button>
          <button class="btn-primary" @click="submitBatch">提交批量归档</button>
        </div>
      </div>
    </div>

    <!-- 通用详情钻取 -->
    <div class="modal-mask" v-if="detail" @click.self="detail = null">
      <div class="modal-box" style="width: 640px">
        <div class="modal-header">{{ detail.title }} <span class="modal-close" @click="detail = null">✕</span></div>
        <div class="modal-body">
          <pre class="detail-pre">{{ detail.json }}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<style scoped>
.module-view { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.header-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.page-title { font-size: 20px; font-weight: 600; color: #1a1a2e; margin: 0; }
.sr-tag { font-size: 12px; color: #888; background: #f5f5f5; padding: 2px 10px; border-radius: 10px; }
.mode-badge { font-size: 11px; padding: 2px 10px; border-radius: 10px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; }
.mode-badge.live { background: #f6ffed; color: #52c41a; }
.mode-badge.demo { background: #fff7e6; color: #faad14; }
.mode-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.mode-badge.live .mode-dot { background: #52c41a; }
.mode-badge.demo .mode-dot { background: #faad14; }
.diag-badge { font-size: 11px; color: #ff4d4f; background: #fff1f0; padding: 2px 10px; border-radius: 10px; cursor: help; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-right { display: flex; align-items: center; gap: 10px; }
.poll-tip { font-size: 11px; color: #bfbfbf; }

.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
.kpi-card { background: #fff; border-radius: 10px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); display: flex; align-items: center; gap: 12px; }
.kpi-card.warn { border: 1px solid #ffccc7; }
.kpi-icon { font-size: 26px; width: 36px; text-align: center; }
.kpi-info { flex: 1; }
.kpi-value { font-size: 20px; font-weight: 700; line-height: 1.2; }
.kpi-label { font-size: 12px; color: #888; margin-top: 4px; }
.kpi-target { font-size: 11px; color: #bfbfbf; margin-top: 2px; }

.tab-bar { display: flex; gap: 4px; background: #fff; padding: 4px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); margin-bottom: 16px; width: fit-content; }
.tab { padding: 7px 16px; font-size: 13px; color: #595959; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
.tab:hover { color: #1890ff; }
.tab.active { background: #1890ff; color: #fff; }
.tab-content { display: flex; flex-direction: column; gap: 16px; }
.content-grid.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
.panel-title { font-size: 15px; font-weight: 600; color: #1a1a2e; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.panel-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
.panel-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.count-tag { font-size: 12px; color: #888; background: #f5f5f5; padding: 2px 8px; border-radius: 10px; font-weight: 400; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { text-align: left; padding: 10px; color: #888; font-weight: 500; border-bottom: 1px solid #f0f0f0; font-size: 12px; white-space: nowrap; }
.data-table td { padding: 10px; border-bottom: 1px solid #f7f7f7; }
.data-table tr:hover td { background: #fafcff; }
.td-primary { font-weight: 600; color: #1890ff; }
.td-err { color: #ff4d4f; }
.err-msg { font-size: 11px; color: #ff4d4f; margin-top: 2px; }
.tier-tag { font-size: 11px; padding: 2px 8px; border-radius: 8px; font-weight: 500; }

.dist-list { display: flex; flex-direction: column; gap: 10px; }
.dist-row { display: flex; align-items: center; gap: 8px; }
.dist-name { font-size: 12px; color: #595959; min-width: 90px; }
.dist-bar { flex: 1; height: 8px; background: #f5f5f5; border-radius: 4px; overflow: hidden; }
.dist-bar i { display: block; height: 100%; background: linear-gradient(90deg, #1890ff, #69c0ff); }
.dist-num { font-size: 12px; font-weight: 600; min-width: 140px; text-align: right; }

.pagination { display: flex; align-items: center; gap: 12px; margin-top: 12px; justify-content: center; }
.page-info { font-size: 12px; color: #888; }

.advice-box { background: linear-gradient(135deg, #f0f7ff, #f6f0ff); border-radius: 8px; padding: 14px; }
.advice-row { display: flex; gap: 10px; padding: 6px 0; align-items: flex-start; }
.advice-label { font-size: 12px; color: #888; min-width: 75px; flex-shrink: 0; padding-top: 2px; }
.advice-text { font-size: 13px; color: #1a1a2e; line-height: 1.6; }
.ai-actions { display: flex; gap: 10px; margin-top: 16px; }

.analysis-list { display: flex; flex-direction: column; gap: 10px; }
.analysis-card { background: #fafafa; border-radius: 8px; padding: 12px; border-left: 3px solid; }
.analysis-card.high { border-left-color: #ff4d4f; background: #fff5f5; }
.analysis-card.medium { border-left-color: #faad14; background: #fffbf0; }
.analysis-card.low { border-left-color: #52c41a; background: #f6fff0; }
.an-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.an-cat { font-size: 14px; font-weight: 600; color: #1a1a2e; }
.an-count { font-size: 11px; color: #888; background: #fff; padding: 1px 8px; border-radius: 8px; }
.an-sev { font-size: 11px; padding: 1px 8px; border-radius: 8px; margin-left: auto; }
.an-sev.high { background: #ff4d4f; color: #fff; }
.an-sev.medium { background: #faad14; color: #fff; }
.an-sev.low { background: #52c41a; color: #fff; }
.an-suggestion { display: flex; gap: 8px; align-items: flex-start; }
.an-label { font-size: 11px; color: #888; min-width: 56px; flex-shrink: 0; padding-top: 1px; }
.an-text { font-size: 12px; color: #1a1a2e; line-height: 1.6; }

.empty-state { text-align: center; padding: 40px 20px; color: #bfbfbf; }
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.empty-text { font-size: 13px; line-height: 1.8; }

.btn-primary { background: #1890ff; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-primary:hover { background: #40a9ff; }
.btn-primary:disabled { background: #91caff; cursor: not-allowed; }
.btn-default { background: #fff; color: #595959; border: 1px solid #d9d9d9; padding: 8px 18px; border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-default:hover { border-color: #1890ff; color: #1890ff; }
.btn-sm { padding: 4px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: 4px; }
.btn-sm.primary { background: #1890ff; color: #fff; border: none; }
.btn-sm.primary:hover { background: #40a9ff; }
.btn-sm.outline { background: #fff; color: #1890ff; border: 1px solid #91caff; }
.btn-sm.outline:hover { background: #e6f7ff; }
.btn-sm.outline.danger { color: #ff4d4f; border-color: #ffa39e; }
.btn-sm.outline.danger:hover { background: #fff1f0; }

.form-input, .form-select { padding: 7px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; outline: none; }
.form-input:focus, .form-select:focus { border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.1); }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal-box { width: 460px; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; font-size: 15px; font-weight: 600; border-bottom: 1px solid #f0f0f0; }
.modal-close { cursor: pointer; color: #888; }
.modal-close:hover { color: #ff4d4f; }
.modal-body { padding: 20px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid #f0f0f0; }
.detail-pre { margin: 0; max-height: 56vh; overflow: auto; background: #f7f8fa; border: 1px solid #eaeaea; border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.6; color: #1a1a2e; white-space: pre-wrap; word-break: break-all; }

.ai-form { display: flex; flex-direction: column; gap: 12px; }
.form-row { display: flex; align-items: flex-start; gap: 10px; }
.form-row label { font-size: 13px; color: #595959; min-width: 85px; padding-top: 6px; }
.form-row .form-input { flex: 1; }
.form-row .form-input:disabled { background: #f5f5f5; color: #888; cursor: not-allowed; }

/* 真实操作警示条 */
.real-warn { margin-top: 14px; padding: 10px 12px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px; font-size: 12px; color: #ad6800; line-height: 1.6; }

/* 批量归档弹窗 */
.batch-tip { font-size: 12px; color: #595959; margin-bottom: 10px; line-height: 1.6; }
.batch-tip code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-size: 11px; color: #c41d7f; }
.batch-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-family: 'SF Mono', 'Consolas', 'Monaco', monospace; font-size: 12px; line-height: 1.55; outline: none; resize: vertical; }
.batch-textarea:focus { border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.1); }
.batch-result { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 12px; line-height: 1.6; background: #f6ffed; border: 1px solid #b7eb8f; color: #237804; }
.batch-result.warn { background: #fff7e6; border-color: #ffd591; color: #ad6800; }

.toast { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); background: #1a1a2e; color: #fff; padding: 10px 22px; border-radius: 8px; font-size: 13px; z-index: 200; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }

@media (max-width: 1100px) { .content-grid.two { grid-template-columns: 1fr; } .kpi-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px) { .kpi-row { grid-template-columns: 1fr; } }
</style>
