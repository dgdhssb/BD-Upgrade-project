<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  lifecycleApi,
  policyHealth,
  storageAdvice,
  SEMANTICS,
  STATUS_FLOW,
  type LifecyclePolicy,
  type MigrationTask,
  type CleanupAudit,
  type StorageResource,
  type DataType,
  type StorageTier,
  type MigrationStatus,
} from '@/api/modules/lifecycle'
// MS-10 归档服务：MQ 链路的上游，用它的真实归档记录与 MS-11 迁移任务做交叉比对
import { archiveApi, type ArchiveRecord } from '@/api/modules/archive'
import ConnectionStatus from '@/components/ConnectionStatus.vue'

/** 单次拉取条数。后端为内存仓储，数据量小，一次拉完即可。 */
const PAGE_SIZE = 50

const activeTab = ref('policies')
const tabs = [
  { key: 'policies', label: '📋 生命周期策略' },
  { key: 'migrations', label: '🔄 迁移任务' },
  { key: 'cleanup', label: '🧹 清理审计' },
  { key: 'storage', label: '💽 存储资源' },
  { key: 'mq', label: '🔗 MQ 联动' },
  { key: 'ai', label: '🤖 智能分析' },
]

const live = ref(false)
const loading = ref(false)
const toastMsg = ref('')
const errors = ref<string[]>([])
const toast = (m: string) => {
  toastMsg.value = m
  setTimeout(() => (toastMsg.value = ''), 3000)
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const policies = ref<LifecyclePolicy[]>([])
const migrations = ref<MigrationTask[]>([])
const cleanups = ref<CleanupAudit[]>([])
const storages = ref<StorageResource[]>([])
const policyTotal = ref(0)
const migrationTotal = ref(0)
const cleanupTotal = ref(0)

// MQ 联动：MS-10 归档服务的真实归档记录（bd3.archive.completed 事件的上游数据）
const archiveRecords = ref<ArchiveRecord[]>([])

// —— 筛选 ——
const filterDataType = ref<DataType | ''>('')
const filterEnabled = ref<'' | 'true' | 'false'>('')

// —— 详情弹窗（接口 3 / 8 / 13 / 19）——
const detail = ref<{ title: string; json: string } | null>(null)
async function showDetail(title: string, fn: () => Promise<{ data: unknown }>) {
  try {
    const r = await fn()
    detail.value = { title, json: JSON.stringify(r.data, null, 2) }
  } catch (e) {
    toast(`详情拉取失败：${errText(e)}`)
  }
}

// —— 弹窗：策略（新建 / 编辑）——
const showPolicyModal = ref(false)
const policyEditing = ref(false)
const policyForm = ref<Partial<LifecyclePolicy>>({
  dataType: 'RAW',
  hotDays: 30,
  nearlineDays: 90,
  totalDays: 365,
  enabled: true,
  hotPath: '/hot',
  nearlinePath: '/nearline',
  coldPath: '/cold',
})
function openCreatePolicy() {
  policyEditing.value = false
  policyForm.value = {
    dataType: 'RAW',
    hotDays: 30,
    nearlineDays: 90,
    totalDays: 365,
    enabled: true,
    hotPath: '/hot',
    nearlinePath: '/nearline',
    coldPath: '/cold',
    createdBy: 'hmi-admin',
  }
  showPolicyModal.value = true
}
function openEditPolicy(p: LifecyclePolicy) {
  policyEditing.value = true
  policyForm.value = { ...p }
  showPolicyModal.value = true
}

// —— 弹窗：迁移（新建 / 状态回调）——
const showMigrationModal = ref(false)
const migrationForm = ref({ archiveId: '', sourceTier: 'HOT' as StorageTier, targetTier: 'NEARLINE' as StorageTier })

const showStatusModal = ref(false)
const statusTarget = ref<MigrationTask | null>(null)
const statusForm = ref<{ status: MigrationStatus; errorMsg: string }>({ status: 'PROCESSING', errorMsg: '' })
function openStatusModal(m: MigrationTask) {
  statusTarget.value = m
  statusForm.value = { status: 'PROCESSING', errorMsg: m.errorMsg ?? '' }
  showStatusModal.value = true
}

// —— 弹窗：清理（新建 / 审批）——
const showCleanupModal = ref(false)
const cleanupForm = ref({ dataType: 'RAW' as DataType, archiveIds: '', fileCount: 1, operator: 'hmi-admin', reason: '' })

const showApproveModal = ref(false)
const approveTarget = ref<CleanupAudit | null>(null)
const approveBy = ref('hmi-admin')
function openApprove(c: CleanupAudit) {
  approveTarget.value = c
  approveBy.value = 'hmi-admin'
  showApproveModal.value = true
}

// —— 弹窗：存储上报 ——
const showStorageModal = ref(false)
const storageForm = ref<Partial<StorageResource>>({
  storageType: 'HOT',
  mountPoint: '/data/hot',
  capacity: 0,
  usage: 0,
  iops: 0,
  latency: 0,
})

// ============ 数据加载 ============

async function loadPolicies() {
  const r = await lifecycleApi.listPolicies({
    dataType: filterDataType.value || undefined,
    enabled: filterEnabled.value === '' ? undefined : filterEnabled.value === 'true',
    page: 1,
    size: PAGE_SIZE,
  })
  policies.value = r.data.records
  policyTotal.value = r.data.total
}
async function loadMigrations() {
  const r = await lifecycleApi.listMigrations({ page: 1, size: PAGE_SIZE })
  migrations.value = r.data.records
  migrationTotal.value = r.data.total
}
async function loadCleanup() {
  const r = await lifecycleApi.listCleanup({ page: 1, size: PAGE_SIZE })
  cleanups.value = r.data.records
  cleanupTotal.value = r.data.total
}
async function loadStorage() {
  const r = await lifecycleApi.listStorage()
  storages.value = r.data
}
/** 拉 MS-10 归档记录。allStats 内部按 dataType 分别容错，errors 非空说明至少一类没拉到 */
async function loadArchiveRecords() {
  const r = await archiveApi.allStats()
  archiveRecords.value = r.data.records
  if (!r.live) throw new Error(r.errors.join(' ｜ '))
}

/** 单个数据源失败不阻断其它数据源，但错误必须全部透出（纯真实模式不静默吞错） */
async function guard(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    errors.value.push(`${label}：${errText(e)}`)
    return false
  }
}

async function loadAll() {
  loading.value = true
  errors.value = []
  const results = await Promise.all([
    guard('策略列表', loadPolicies),
    guard('迁移任务列表', loadMigrations),
    guard('清理审计列表', loadCleanup),
    guard('存储资源列表', loadStorage),
    guard('MS-10 归档记录（MQ 上游）', loadArchiveRecords),
  ])
  // 只要有一个数据源通了就认为后端在线；全挂则为离线
  live.value = results.some(Boolean)
  loading.value = false
}

// ============ KPI & AI ============

const kpi = computed(() => ({
  policies: policies.value.length,
  enabledPolicies: policies.value.filter((p) => p.enabled).length,
  migrations: migrations.value.length,
  failedMigrations: migrations.value.filter((m) => m.status === 'FAILED').length,
  pendingCleanup: cleanups.value.filter((c) => c.status === 'PENDING').length,
  storageUsage: storages.value.length
    ? Math.round(
        (storages.value.reduce((s, r) => s + (r.usage || 0), 0) /
          Math.max(1, storages.value.reduce((s, r) => s + (r.capacity || 0), 0))) *
          100,
      )
    : 0,
}))

const policyIssues = computed(() => policyHealth(policies.value))
const storageSug = computed(() => storageAdvice(storages.value))

/** 迁移任务洞察：基于真实状态分布给出可执行提醒 */
const migrationInsight = computed(() => {
  const total = migrations.value.length
  const failed = migrations.value.filter((m) => m.status === 'FAILED').length
  const processing = migrations.value.filter((m) => m.status === 'PROCESSING').length
  const pending = migrations.value.filter((m) => m.status === 'PENDING').length
  const retrying = migrations.value.filter((m) => m.retryCount > 0).length
  const severity = failed > 0 ? 'high' : pending + processing > 0 ? 'medium' : 'low'
  const text =
    total === 0
      ? '暂无迁移任务。注意：本服务只记录任务状态，不搬运文件，需由外部执行方回调状态接口推进。'
      : `共 ${total} 条：PENDING ${pending} / PROCESSING ${processing} / SUCCESS ${total - failed - processing - pending} / FAILED ${failed}${retrying ? `；其中 ${retrying} 条经历过重试` : ''}。${
          failed > 0
            ? '存在失败任务，可点「重试」让后端回到 PENDING；若反复失败说明外部执行方未真正搬运文件。'
            : pending + processing > 0
              ? '有任务处于进行中，需等待外部执行方回调状态接口（PUT /migrations/{id}/status）。'
              : '全部迁移任务已完成。'
        }`
  return { severity, text } as const
})

/** 清理审计洞察 */
const cleanupInsight = computed(() => {
  const pending = cleanups.value.filter((c) => c.status === 'PENDING').length
  const approved = cleanups.value.filter((c) => c.status === 'APPROVED').length
  const executed = cleanups.value.filter((c) => c.status === 'EXECUTED').length
  const rejected = cleanups.value.filter((c) => c.status === 'REJECTED').length
  const severity = pending > 5 ? 'high' : pending > 0 ? 'medium' : 'low'
  const text = `待审批 ${pending} / 已批准 ${approved} / 已执行 ${executed} / 已驳回 ${rejected}。${
    pending > 5
      ? '待审批积压较多，建议尽快处理。'
      : pending > 0
        ? '有待审批请求等待处理。'
        : '无待审批积压。'
  }注意：执行清理只推状态不删物理文件。`
  return { severity, text } as const
})

// ============ MQ 联动（MS-10 ⇄ MS-11 事件链路） ============

/**
 * 消息契约来自《MS-11生命周期服务_消息契约.md》，并对照《MS-10归档服务_消息契约.md》。
 * 两份文档是同一条链路的两端：MS-10 的出站 `bd3.archive.completed` == MS-11 的入站同一个 topic。
 * ⚠️ 浏览器无法直连 RocketMQ，本视图不订阅任何事件；
 *    「是否已联动」是通过比对两个服务的 HTTP 数据推断出来的，见 linkage。
 */

/** 入站消费后后端执行的三步动作（MS-11 消息契约 §2.1「触发动作」列） */
const CONSUME_STEPS = [
  {
    n: 1,
    title: '查启用策略',
    desc: '按 dataType 找 enabled=true 的生命周期策略。没匹配到就什么都不做，不会建任何任务。',
  },
  {
    n: 2,
    title: '递进评估',
    desc: '按 HOT → NEARLINE → COLD 顺序，结合策略的 hotDays / nearlineDays / totalDays 判断是否该降级。',
  },
  {
    n: 3,
    title: '按需建任务',
    desc: '只有评估认为需要降级时才创建迁移任务，实现为 MigrationTaskService.evaluateOnArchiveCompleted。',
  },
] as const

const MQ_CONTRACT = [
  {
    topic: 'bd3.archive.completed',
    dir: 'in' as const,
    from: 'archive（MS-10）',
    to: 'lifecycle（MS-11）',
    tag: 'RAW / DIFF / FIELD',
    status: '本组设计完成（待 sign-off）',
    level: 'ok' as const,
    action: '消费后查启用策略 → 按 HOT→NEARLINE→COLD 递进评估 → 按需建迁移任务',
    impl: 'MigrationTaskService.evaluateOnArchiveCompleted',
    note: '🔴 关键词是「按需」：不是每条归档完成事件都会建迁移任务。策略评估认为还没到降级阈值就不建——所以「归档有记录但没有迁移任务」未必是故障，判读要分三档，见下方联动核对表。',
    body: {
      schemaVersion: 'v0.1',
      archiveId: '',
      dataType: '',
      stationId: '',
      fileSize: 0,
      storedPath: '',
      storageTier: '',
      timestamp: 0,
    },
    mapping: [
      ['archiveId', 'MS-10 归档记录 .id', '⚠️ 字段名不一致：HTTP 响应里叫 id，MQ 事件里叫 archiveId'],
      ['dataType', 'MS-10 归档记录 .dataType', '同时是 MQ tag 的取值来源，也是匹配策略的依据'],
      ['stationId', 'MS-10 归档记录 .stationId', 'FIELD 类型可能为空，用 taskId 兜底'],
      ['fileSize', 'MS-10 归档记录 .fileSize', ''],
      ['storedPath', 'MS-10 归档记录 .filePath', '⚠️ 字段名不一致：filePath → storedPath'],
      ['storageTier', 'MS-10 归档记录 .storageTier', '评估降级的起点'],
    ] as const,
  },
  {
    topic: 'bd3.log.audit',
    dir: 'out' as const,
    from: 'lifecycle（MS-11）',
    to: 'log（MS-16）写入',
    tag: '*',
    status: '本组设计完成（待 sign-off）',
    level: 'ok' as const,
    action: '',
    impl: '',
    note: 'module 固定为 LIFECYCLE —— 与 MS-10 投递到同一 topic 时用 ARCHIVE 区分。',
    body: {
      schemaVersion: 'v0.1',
      module: 'LIFECYCLE',
      operation: '',
      userId: '',
      username: '',
      success: true,
      params: '',
      result: '',
      timestamp: 0,
    },
    mapping: [] as const,
  },
]

/**
 * 联动判读的三档结果。
 * 🔴 不能简单把「没有迁移任务」当成故障 —— MS-11 消息契约 §2.1 写明消费后是「**按需**建迁移任务」：
 *    先按 dataType 查启用策略，再按 HOT→NEARLINE→COLD 递进评估，没到降级阈值就不建。
 *    所以「有归档无任务」可能是预期行为，必须结合有没有匹配策略来区分。
 */
type LinkageState = 'TRIGGERED' | 'NO_POLICY' | 'PENDING_EVAL'

interface LinkageRow {
  archiveId: string
  dataType: string
  stationId: string
  fileSize: number
  storageTier: string
  migrations: MigrationTask[]
  matchedPolicy: LifecyclePolicy | null
  state: LinkageState
}

/** 按 dataType 索引的启用策略 —— 后端消费事件时第一步就查这个 */
const enabledPolicyByType = computed(() => {
  const m = new Map<string, LifecyclePolicy>()
  for (const p of policies.value) {
    if (!p.enabled) continue
    if (!m.has(p.dataType)) m.set(p.dataType, p) // 同类多条时取第一条
  }
  return m
})

/** 按 archiveId 把 MS-10 归档记录与 MS-11 迁移任务对上，验证 MQ 链路是否真的产生了迁移 */
const linkage = computed<LinkageRow[]>(() => {
  const byArchive = new Map<string, MigrationTask[]>()
  for (const m of migrations.value) {
    const arr = byArchive.get(m.archiveId)
    if (arr) arr.push(m)
    else byArchive.set(m.archiveId, [m])
  }
  const policyMap = enabledPolicyByType.value
  return archiveRecords.value
    .filter((r) => !r.deleted)
    .map((r) => {
      const ms = byArchive.get(r.id) ?? []
      const policy = policyMap.get(r.dataType) ?? null
      const state: LinkageState = ms.length > 0 ? 'TRIGGERED' : !policy ? 'NO_POLICY' : 'PENDING_EVAL'
      return {
        archiveId: r.id,
        dataType: r.dataType,
        stationId: r.stationId ?? r.taskId ?? '-',
        fileSize: r.fileSize,
        storageTier: r.storageTier,
        migrations: ms,
        matchedPolicy: policy,
        state,
      }
    })
})

const linkageStat = computed(() => {
  const ids = new Set(archiveRecords.value.filter((r) => !r.deleted).map((r) => r.id))
  return {
    total: linkage.value.length,
    triggered: linkage.value.filter((r) => r.state === 'TRIGGERED').length,
    noPolicy: linkage.value.filter((r) => r.state === 'NO_POLICY').length,
    pendingEval: linkage.value.filter((r) => r.state === 'PENDING_EVAL').length,
    // 迁移任务里的 archiveId 在归档记录里找不到 —— 归档已软删或两服务数据不一致
    orphan: migrations.value.filter((m) => !ids.has(m.archiveId)).length,
  }
})

const STATE_LABEL: Record<LinkageState, string> = {
  TRIGGERED: '✅ 已建迁移任务',
  NO_POLICY: '⚪ 无启用策略（预期）',
  PENDING_EVAL: '⚠️ 待确认',
}
const STATE_CLASS: Record<LinkageState, string> = {
  TRIGGERED: 'ok',
  NO_POLICY: 'off',
  PENDING_EVAL: 'warn',
}

function nextTier(t: string): StorageTier | null {
  if (t === 'HOT') return 'NEARLINE'
  if (t === 'NEARLINE') return 'COLD'
  return null
}

/**
 * 对「归档已存在但没有迁移任务」的记录补触发一次迁移。
 * 这是真实写入 MS-11，效果等同于 MQ 事件到达——但必须让用户知道**消息不是前端发的**。
 */
async function triggerMigrationFor(row: LinkageRow) {
  const target = nextTier(row.storageTier)
  if (!target) {
    toast(`${row.storageTier} 已是最冷层，无需再迁移`)
    return
  }
  // 无启用策略时后端永远不会自动建任务，补触发前要点明这一点，避免误判成链路故障
  const policyHint =
    row.state === 'NO_POLICY'
      ? `⚠️ 该 dataType（${row.dataType}）当前没有启用中的策略，后端消费事件时不会为它建任何任务。\n` +
        `   手动补触发可以建，但同样的归档下次仍不会自动迁移——先去「生命周期策略」tab 建一条启用策略。\n\n`
      : row.state === 'PENDING_EVAL'
        ? `注意：已有启用策略（${row.matchedPolicy?.policyName ?? '-'}）但没有迁移任务。\n` +
          `   可能是策略评估后认为还没到降级阈值（正常），也可能事件根本没到达。\n` +
          `   补触发前建议先核对策略的 hotDays/nearlineDays 与该归档的创建时间。\n\n`
        : ''
  const ok = confirm(
    `为归档 ${row.archiveId}（${row.dataType}）补触发迁移？\n\n` +
      `${row.storageTier} → ${target}\n\n` +
      policyHint +
      `⚠️ 这是人工补触发，会真实调用 MS-11 的 POST /migrations。\n` +
      `它模拟的是 bd3.archive.completed 事件到达后的效果，但前端没有也不会发 MQ 消息——\n` +
      `真实链路应由 archive 服务自己投递。`,
  )
  if (!ok) return
  try {
    await lifecycleApi.createMigration({
      archiveId: row.archiveId,
      sourceTier: row.storageTier as StorageTier,
      targetTier: target,
    })
    toast('已补触发迁移任务（真实写入 MS-11）')
    await guard('刷新迁移列表', loadMigrations)
  } catch (e) {
    toast(`补触发失败：${errText(e)}`)
  }
}

// ============ 写操作 ============

async function submitPolicy() {
  try {
    if (policyEditing.value) {
      const id = policyForm.value.policyId
      if (!id) {
        toast('缺少策略ID，无法更新')
        return
      }
      // 接口 4：dataType 不可变，且 policyId 走路径参数 —— 两者都不进请求体
      const { policyId, dataType, ...rest } = policyForm.value
      void policyId
      void dataType
      await lifecycleApi.updatePolicy(id, rest)
      toast('策略已更新（真实后端）')
    } else {
      await lifecycleApi.createPolicy(policyForm.value)
      toast('策略已创建（真实后端）')
    }
    showPolicyModal.value = false
    await guard('刷新策略列表', loadPolicies)
  } catch (e) {
    toast(`${policyEditing.value ? '更新' : '创建'}失败：${errText(e)}`)
  }
}
async function removePolicy(p: LifecyclePolicy) {
  // 接口 5：后端在有执行中任务时会拒绝删除，这里如实把后端错误抛给用户
  if (!confirm(`确认删除策略「${p.policyName}」(${p.policyId})？\n若存在执行中的迁移任务，后端会拒绝删除。`)) return
  try {
    await lifecycleApi.deletePolicy(p.policyId)
    toast('策略已删除')
    await guard('刷新策略列表', loadPolicies)
  } catch (e) {
    toast(`删除失败：${errText(e)}`)
  }
}

async function submitMigration() {
  if (!migrationForm.value.archiveId.trim()) {
    toast('请填写归档ID')
    return
  }
  try {
    await lifecycleApi.createMigration({
      archiveId: migrationForm.value.archiveId.trim(),
      sourceTier: migrationForm.value.sourceTier,
      targetTier: migrationForm.value.targetTier,
    })
    toast('迁移任务已创建（仅落库，不搬文件）')
    showMigrationModal.value = false
    await guard('刷新迁移列表', loadMigrations)
  } catch (e) {
    toast(`创建失败：${errText(e)}`)
  }
}
async function submitStatus() {
  const t = statusTarget.value
  if (!t) return
  try {
    await lifecycleApi.updateMigrationStatus(
      t.id,
      statusForm.value.status,
      statusForm.value.errorMsg.trim() || undefined,
    )
    toast(`状态已回写为 ${statusForm.value.status}`)
    showStatusModal.value = false
    await guard('刷新迁移列表', loadMigrations)
  } catch (e) {
    toast(`状态回写失败：${errText(e)}`)
  }
}
async function doRetry(id: string) {
  try {
    await lifecycleApi.retryMigration(id)
    toast('已重试（后端将状态回 PENDING）')
    await guard('刷新迁移列表', loadMigrations)
  } catch (e) {
    toast(`重试失败：${errText(e)}`)
  }
}

function parseArchiveIds(raw: string): string {
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',')
}

async function submitCleanup() {
  const ids = parseArchiveIds(cleanupForm.value.archiveIds)
  if (!ids) {
    toast('请填写至少一个归档ID')
    return
  }
  try {
    await lifecycleApi.createCleanup({
      dataType: cleanupForm.value.dataType,
      archiveIds: ids,
      fileCount: cleanupForm.value.fileCount,
      operator: cleanupForm.value.operator.trim() || 'hmi-admin',
      reason: cleanupForm.value.reason.trim(),
    })
    toast('清理请求已创建')
    showCleanupModal.value = false
    await guard('刷新清理列表', loadCleanup)
  } catch (e) {
    toast(`创建失败：${errText(e)}`)
  }
}
async function submitApprove() {
  const c = approveTarget.value
  if (!c) return
  if (!approveBy.value.trim()) {
    toast('请填写审批人')
    return
  }
  try {
    await lifecycleApi.approveCleanup(c.id, approveBy.value.trim())
    toast('已审批通过')
    showApproveModal.value = false
    await guard('刷新清理列表', loadCleanup)
  } catch (e) {
    toast(`审批失败：${errText(e)}`)
  }
}
async function doReject(c: CleanupAudit) {
  const reason = prompt('填写驳回原因（可留空）：', '')
  if (reason === null) return
  try {
    await lifecycleApi.rejectCleanup(c.id, reason.trim() || undefined)
    toast('已驳回')
    await guard('刷新清理列表', loadCleanup)
  } catch (e) {
    toast(`驳回失败：${errText(e)}`)
  }
}
async function doExecute(c: CleanupAudit) {
  // 接口 16 只推状态不删文件 —— 执行前明确告知，避免误以为文件已删
  if (!confirm(`确认执行清理 ${c.id}？\n\n${SEMANTICS.cleanupExecute}\n\n执行后状态变为 EXECUTED 且不可回退。`)) return
  try {
    await lifecycleApi.executeCleanup(c.id)
    toast('已执行（仅状态推进为 EXECUTED，未删除物理文件）')
    await guard('刷新清理列表', loadCleanup)
  } catch (e) {
    toast(`执行失败：${errText(e)}`)
  }
}

async function submitStorage() {
  try {
    await lifecycleApi.reportStorage(storageForm.value)
    toast('存储指标已上报（upsert）')
    showStorageModal.value = false
    await guard('刷新存储列表', loadStorage)
  } catch (e) {
    toast(`上报失败：${errText(e)}`)
  }
}

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  loadAll()
  timer = setInterval(loadAll, 20000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="module-view">
    <!-- MS-11 的 19 个接口里没有独立 health 端点，只能用业务端点做在线探针 -->
    <ConnectionStatus
      service-name="数据生命周期服务（MS-11）"
      :port="18091"
      health-path="/api/v1/lifecycle/policies?page=1&size=1"
      mode="real"
    />

    <div class="page-head">
      <h2>📊 数据生命周期管理 <span class="sub">MS-11 · bd-lifecycle-service · 18091</span></h2>
      <button class="btn" :disabled="loading" @click="loadAll">{{ loading ? '刷新中…' : '刷新' }}</button>
    </div>

    <!-- 后端原始错误：纯真实模式，绝不用演示数据兜底 -->
    <div v-if="errors.length" class="diag-panel">
      <div class="diag-title">⚠ 后端接口异常（未做任何降级，以下为后端原始报错）</div>
      <ul>
        <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
      </ul>
      <div class="diag-hint">
        纯真实模式：接口失败时不会填充任何演示数据。请确认 18091 服务已启动，或点击上方状态条的「重试」。
      </div>
    </div>

    <!-- KPI -->
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-num">{{ kpi.enabledPolicies }}<span class="kpi-sub">/{{ kpi.policies }}</span></div>
        <div class="kpi-label">启用策略 / 总数</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" :class="{ danger: kpi.failedMigrations > 0 }">{{ kpi.migrations }}</div>
        <div class="kpi-label">迁移任务（失败 {{ kpi.failedMigrations }}）</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" :class="{ danger: kpi.pendingCleanup > 0 }">{{ kpi.pendingCleanup }}</div>
        <div class="kpi-label">待审批清理</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" :class="{ danger: kpi.storageUsage > 85 }">{{ kpi.storageUsage }}%</div>
        <div class="kpi-label">存储使用率</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- ============ 策略 ============ -->
    <section v-show="activeTab === 'policies'" class="tab-panel">
      <div class="toolbar">
        <select v-model="filterDataType" @change="loadAll">
          <option value="">全部数据类型</option>
          <option value="RAW">RAW</option>
          <option value="DIFF">DIFF</option>
          <option value="FIELD">FIELD</option>
        </select>
        <select v-model="filterEnabled" @change="loadAll">
          <option value="">全部状态</option>
          <option value="true">仅启用</option>
          <option value="false">仅停用</option>
        </select>
        <span class="total-hint">共 {{ policyTotal }} 条{{ policyTotal > PAGE_SIZE ? `（显示前 ${PAGE_SIZE} 条）` : '' }}</span>
        <button class="btn primary" @click="openCreatePolicy">+ 新建策略</button>
      </div>
      <div class="notice">策略流转：HOT → NEARLINE → COLD，天数需满足 HOT ≤ NEARLINE ≤ TOTAL，否则数据无法正确降级。</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>策略ID</th><th>名称</th><th>数据类型</th><th>HOT/NEAR/TOTAL(天)</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in policies" :key="p.policyId">
            <td>{{ p.policyId }}</td>
            <td>{{ p.policyName }}</td>
            <td><span class="tag dt">{{ p.dataType }}</span></td>
            <td>{{ p.hotDays }}/{{ p.nearlineDays }}/{{ p.totalDays }}</td>
            <td><span class="tag" :class="p.enabled ? 'ok' : 'off'">{{ p.enabled ? '启用' : '停用' }}</span></td>
            <td class="ops">
              <button class="btn sm" @click="showDetail(`策略详情 · ${p.policyId}`, () => lifecycleApi.getPolicy(p.policyId))">详情</button>
              <button class="btn sm" @click="openEditPolicy(p)">编辑</button>
              <button class="btn sm danger" @click="removePolicy(p)">删除</button>
            </td>
          </tr>
          <tr v-if="!policies.length">
            <td colspan="6" class="empty">暂无数据（后端内存仓储，可点「新建策略」写入真实数据）</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ 迁移 ============ -->
    <section v-show="activeTab === 'migrations'" class="tab-panel">
      <div class="toolbar">
        <span class="total-hint">共 {{ migrationTotal }} 条{{ migrationTotal > PAGE_SIZE ? `（显示前 ${PAGE_SIZE} 条）` : '' }}</span>
        <button class="btn primary" @click="showMigrationModal = true">+ 触发迁移</button>
      </div>
      <div class="warn-block">
        <b>⚠️ 联调重点：{{ SEMANTICS.migration }}</b>
        <div class="flow">状态机：{{ STATUS_FLOW.migration }}</div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>任务ID</th><th>归档ID</th><th>源→目标</th><th>状态</th><th>重试</th><th>错误</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in migrations" :key="m.id">
            <td>{{ m.id }}</td>
            <td>{{ m.archiveId }}</td>
            <td>{{ m.sourceTier }} → {{ m.targetTier }}</td>
            <td><span class="tag" :class="m.status === 'SUCCESS' ? 'ok' : m.status === 'FAILED' ? 'bad' : 'warn'">{{ m.status }}</span></td>
            <td>{{ m.retryCount }}</td>
            <td class="err-cell" :title="m.errorMsg || ''">{{ m.errorMsg || '-' }}</td>
            <td class="ops">
              <button class="btn sm" @click="showDetail(`迁移详情 · ${m.id}`, () => lifecycleApi.getMigration(m.id))">详情</button>
              <button class="btn sm" @click="openStatusModal(m)">状态回调</button>
              <button class="btn sm" :disabled="m.status !== 'FAILED'" @click="doRetry(m.id)">重试</button>
            </td>
          </tr>
          <tr v-if="!migrations.length">
            <td colspan="7" class="empty">暂无数据（可点「触发迁移」创建真实任务）</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ 清理 ============ -->
    <section v-show="activeTab === 'cleanup'" class="tab-panel">
      <div class="toolbar">
        <span class="total-hint">共 {{ cleanupTotal }} 条{{ cleanupTotal > PAGE_SIZE ? `（显示前 ${PAGE_SIZE} 条）` : '' }}</span>
        <button class="btn primary" @click="showCleanupModal = true">+ 新建清理请求</button>
      </div>
      <div class="warn-block">
        <b>⚠️ 联调重点：{{ SEMANTICS.cleanupExecute }}</b>
        <div class="flow">状态机：{{ STATUS_FLOW.cleanup }}</div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th><th>数据类型</th><th>归档ID</th><th>文件数</th><th>操作人</th><th>审批人</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cleanups" :key="c.id">
            <td>{{ c.id }}</td>
            <td><span class="tag dt">{{ c.dataType }}</span></td>
            <td class="err-cell" :title="c.archiveIds">{{ c.archiveIds }}</td>
            <td>{{ c.fileCount }}</td>
            <td>{{ c.operator }}</td>
            <td>{{ c.approvedBy || '-' }}</td>
            <td>
              <span
                class="tag"
                :class="c.status === 'EXECUTED' ? 'ok' : c.status === 'REJECTED' ? 'bad' : 'warn'"
              >{{ c.status }}</span>
            </td>
            <td class="ops">
              <button class="btn sm" @click="showDetail(`清理详情 · ${c.id}`, () => lifecycleApi.getCleanup(c.id))">详情</button>
              <button v-if="c.status === 'PENDING'" class="btn sm" @click="openApprove(c)">审批</button>
              <button v-if="c.status === 'PENDING'" class="btn sm" @click="doReject(c)">驳回</button>
              <button v-if="c.status === 'APPROVED'" class="btn sm primary" @click="doExecute(c)">执行</button>
            </td>
          </tr>
          <tr v-if="!cleanups.length">
            <td colspan="8" class="empty">暂无数据（可点「新建清理请求」写入真实审计记录）</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ 存储 ============ -->
    <section v-show="activeTab === 'storage'" class="tab-panel">
      <div class="toolbar">
        <span class="total-hint">共 {{ storages.length }} 条</span>
        <button class="btn primary" @click="showStorageModal = true">+ 上报存储指标</button>
      </div>
      <div class="notice">{{ SEMANTICS.storage }}</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th><th>类型</th><th>挂载点</th><th>容量</th><th>用量</th><th>使用率</th><th>IOPS</th><th>延迟(ms)</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in storages" :key="s.id">
            <td>{{ s.id }}</td>
            <td><span class="tag dt">{{ s.storageType }}</span></td>
            <td>{{ s.mountPoint }}</td>
            <td>{{ s.capacity }}</td>
            <td>{{ s.usage }}</td>
            <td>
              <span
                class="tag"
                :class="(s.capacity ? Math.round((s.usage / s.capacity) * 100) : 0) > 85 ? 'bad' : 'ok'"
              >{{ s.capacity ? Math.round((s.usage / s.capacity) * 100) : 0 }}%</span>
            </td>
            <td>{{ s.iops }}</td>
            <td>{{ s.latency }}</td>
            <td class="ops">
              <button class="btn sm" @click="showDetail(`存储详情 · ${s.id}`, () => lifecycleApi.getStorage(s.id))">详情</button>
            </td>
          </tr>
          <tr v-if="!storages.length">
            <td colspan="9" class="empty">暂无数据（可点「上报存储指标」写入真实指标）</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ MQ 联动（MS-11 视角） ============ -->
    <section v-show="activeTab === 'mq'" class="tab-panel">
      <div class="notice">
        <b>本视图不做任何事件订阅。</b>
        浏览器无法直连 RocketMQ，下面的「是否已联动」是通过比对
        <b>MS-10 归档服务的真实归档记录</b>、<b>MS-11 的真实策略与迁移任务</b>推断出来的，不是消费消息得到的。
      </div>

      <!-- 入站：消费后做什么 -->
      <h3 class="sec-title">入站消费链路（MS-11 被事件驱动）</h3>
      <div class="mq-graph">
        <div class="mq-row">
          <span class="mq-node">archive 归档服务 · MS-10</span>
          <span class="mq-arrow hot">
            <b>bd3.archive.completed</b>
            <em>tag: RAW / DIFF / FIELD</em>
          </span>
          <span class="mq-node cur">lifecycle 数据生命周期 · MS-11（本页）</span>
        </div>
        <div class="mq-row">
          <span class="mq-node cur">lifecycle 数据生命周期 · MS-11（本页）</span>
          <span class="mq-arrow">
            <b>bd3.log.audit</b>
            <em>tag: * · module: LIFECYCLE</em>
          </span>
          <span class="mq-node dim">log 操作审计 · MS-16</span>
        </div>
      </div>

      <div class="steps">
        <div v-for="s in CONSUME_STEPS" :key="s.n" class="step">
          <span class="step-n">{{ s.n }}</span>
          <div class="step-body">
            <div class="step-title">{{ s.title }}</div>
            <div class="step-desc">{{ s.desc }}</div>
          </div>
        </div>
      </div>
      <div class="warn-block">
        <b>🔴 判读要点：上面第 3 步是「按需」建任务</b>，不是每条归档完成事件都会产生迁移任务。
        所以<b>「有归档记录但没有迁移任务」不等于链路故障</b>——必须先看该 dataType 有没有启用中的策略。
        本服务不主动 HTTP 调用任何兄弟服务，完全由归档完成事件驱动。
      </div>

      <!-- 联动核对：真实数据交叉比对 -->
      <h3 class="sec-title">联动核对（真实数据交叉比对）</h3>
      <div class="kpi-row five">
        <div class="kpi-card">
          <div class="kpi-num">{{ linkageStat.total }}</div>
          <div class="kpi-label">MS-10 归档记录</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num ok-text">{{ linkageStat.triggered }}</div>
          <div class="kpi-label">已建迁移任务</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num muted">{{ linkageStat.noPolicy }}</div>
          <div class="kpi-label">无启用策略（预期）</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num" :class="{ danger: linkageStat.pendingEval > 0 }">{{ linkageStat.pendingEval }}</div>
          <div class="kpi-label">待确认</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num" :class="{ danger: linkageStat.orphan > 0 }">{{ linkageStat.orphan }}</div>
          <div class="kpi-label">孤儿迁移（归档已不存在）</div>
        </div>
      </div>

      <div class="warn-block">
        <b>怎么读这张表：</b>匹配键是 <code>archiveId</code>。
        ⚠️ 同一个值有三个名字 —— MS-10 的 HTTP 响应里叫 <code>id</code>，MQ 事件里叫
        <code>archiveId</code>，MS-11 迁移任务里也叫 <code>archiveId</code>。
        三个都指同一条归档，联调时别被字段名带偏。
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>归档ID（= MQ archiveId）</th><th>数据类型 / tag</th><th>测站</th><th>大小</th>
            <th>当前分级</th><th>匹配策略</th><th>判读</th><th>迁移任务</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in linkage" :key="row.archiveId">
            <td class="mono">{{ row.archiveId }}</td>
            <td><span class="tag dt">{{ row.dataType }}</span></td>
            <td>{{ row.stationId }}</td>
            <td>{{ row.fileSize }}</td>
            <td><span class="tag dt">{{ row.storageTier }}</span></td>
            <td>
              <span v-if="row.matchedPolicy" class="mono">{{ row.matchedPolicy.policyName }}</span>
              <span v-else class="muted-text">无启用策略</span>
            </td>
            <td>
              <span class="tag" :class="STATE_CLASS[row.state]">{{ STATE_LABEL[row.state] }}</span>
            </td>
            <td>
              <span v-if="!row.migrations.length">-</span>
              <span v-for="m in row.migrations" :key="m.id" class="mig-chip">
                {{ m.sourceTier }}→{{ m.targetTier }}
                <b :class="m.status === 'SUCCESS' ? 'ok-text' : m.status === 'FAILED' ? 'bad-text' : ''">{{ m.status }}</b>
              </span>
            </td>
            <td class="ops">
              <button class="btn sm" :disabled="nextTier(row.storageTier) === null" @click="triggerMigrationFor(row)">
                补触发迁移
              </button>
            </td>
          </tr>
          <tr v-if="!linkage.length">
            <td colspan="9" class="empty">
              暂无归档记录。MS-10 未启动，或尚未归档任何数据 —— 归档完成才会投递 bd3.archive.completed。
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 消息体契约 -->
      <h3 class="sec-title">消息体契约（MS-11 视角，对照《MS-11生命周期服务_消息契约.md》）</h3>
      <div class="warn-block">
        以下是<b>契约文本</b>，不是运行时数据 —— 浏览器拿不到 MQ 消息，这里只作联调时核对字段用。
      </div>
      <div v-for="t in MQ_CONTRACT" :key="t.topic" class="topic-card">
        <div class="topic-head">
          <span class="topic-name">{{ t.topic }}</span>
          <span class="tag" :class="t.dir === 'in' ? 'warn' : 'ok'">{{ t.dir === 'in' ? '入站' : '出站' }}</span>
          <span class="tag" :class="t.level">{{ t.status }}</span>
        </div>
        <div class="topic-meta">{{ t.from }} → {{ t.to }} · tag: {{ t.tag }}</div>
        <div v-if="t.action" class="topic-action">
          <span class="action-label">触发动作</span>{{ t.action }}
          <span v-if="t.impl" class="mono"> · {{ t.impl }}</span>
        </div>
        <div class="topic-note">{{ t.note }}</div>
        <pre class="schema-pre">{{ JSON.stringify(t.body, null, 2) }}</pre>
        <div v-if="t.mapping.length" class="mapping">
          <div class="mapping-title">字段映射（MQ 消息体 ← MS-10 真实归档记录）</div>
          <table class="data-table compact">
            <thead><tr><th>消息体字段</th><th>数据来源</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="(m, i) in t.mapping" :key="i">
                <td class="mono">{{ m[0] }}</td>
                <td class="mono">{{ m[1] }}</td>
                <td :class="{ 'bad-text': m[2].startsWith('⚠️') }">{{ m[2] || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ============ AI ============ -->
    <section v-show="activeTab === 'ai'" class="tab-panel">
      <div class="ai-block">
        <h3>策略健康度</h3>
        <div v-for="(i, idx) in policyIssues" :key="idx" class="ai-item" :class="i.severity">
          <b>{{ i.issue }}</b>（{{ i.count }}）<br /><small>{{ i.advice }}</small>
        </div>
      </div>
      <div class="ai-block">
        <h3>存储容量建议</h3>
        <div class="ai-item" :class="kpi.storageUsage > 85 ? 'high' : kpi.storageUsage > 60 ? 'medium' : 'low'">
          <b>使用率 {{ kpi.storageUsage }}%</b><br /><small>{{ storageSug.suggestion }}</small>
        </div>
      </div>
      <div class="ai-block">
        <h3>迁移任务洞察</h3>
        <div class="ai-item" :class="migrationInsight.severity">
          <small>{{ migrationInsight.text }}</small>
        </div>
      </div>
      <div class="ai-block">
        <h3>清理审计洞察</h3>
        <div class="ai-item" :class="cleanupInsight.severity">
          <small>{{ cleanupInsight.text }}</small>
        </div>
      </div>
      <div class="notice">以上分析均由前端基于当前页面的真实数据实时计算，不产生任何后端写入。</div>
    </section>

    <!-- ============ 弹窗 ============ -->

    <!-- 策略 新建/编辑 -->
    <div class="modal-mask" v-if="showPolicyModal" @click.self="showPolicyModal = false">
      <div class="modal">
        <h3>{{ policyEditing ? '编辑生命周期策略' : '新建生命周期策略' }}</h3>
        <div v-if="policyEditing" class="modal-tip">接口约束：dataType 不可变，此项已锁定。</div>
        <label>名称<input v-model="policyForm.policyName" placeholder="如 raw-30d" /></label>
        <label>
          数据类型
          <select v-model="policyForm.dataType" :disabled="policyEditing">
            <option value="RAW">RAW</option>
            <option value="DIFF">DIFF</option>
            <option value="FIELD">FIELD</option>
          </select>
        </label>
        <div class="form-grid">
          <label>HOT天数<input type="number" v-model.number="policyForm.hotDays" /></label>
          <label>NEARLINE天数<input type="number" v-model.number="policyForm.nearlineDays" /></label>
          <label>TOTAL天数<input type="number" v-model.number="policyForm.totalDays" /></label>
        </div>
        <label>HOT路径<input v-model="policyForm.hotPath" /></label>
        <label>NEARLINE路径<input v-model="policyForm.nearlinePath" /></label>
        <label>COLD路径<input v-model="policyForm.coldPath" /></label>
        <label class="inline">
          <input type="checkbox" v-model="policyForm.enabled" /> 启用该策略
        </label>
        <div class="modal-actions">
          <button class="btn" @click="showPolicyModal = false">取消</button>
          <button class="btn primary" @click="submitPolicy">{{ policyEditing ? '保存' : '创建' }}</button>
        </div>
      </div>
    </div>

    <!-- 迁移 新建 -->
    <div class="modal-mask" v-if="showMigrationModal" @click.self="showMigrationModal = false">
      <div class="modal">
        <h3>触发迁移任务</h3>
        <div class="real-warn">{{ SEMANTICS.migration }}</div>
        <label>归档ID<input v-model="migrationForm.archiveId" placeholder="如 arc-001" /></label>
        <label>
          源分级
          <select v-model="migrationForm.sourceTier">
            <option value="HOT">HOT</option>
            <option value="NEARLINE">NEARLINE</option>
            <option value="COLD">COLD</option>
          </select>
        </label>
        <label>
          目标分级
          <select v-model="migrationForm.targetTier">
            <option value="NEARLINE">NEARLINE</option>
            <option value="COLD">COLD</option>
            <option value="HOT">HOT</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn" @click="showMigrationModal = false">取消</button>
          <button class="btn primary" @click="submitMigration">创建</button>
        </div>
      </div>
    </div>

    <!-- 迁移 状态回调（模拟外部执行方回调） -->
    <div class="modal-mask" v-if="showStatusModal" @click.self="showStatusModal = false">
      <div class="modal">
        <h3>状态回调 · {{ statusTarget?.id }}</h3>
        <div class="modal-tip">
          对应接口 9（PUT /migrations/{id}/status）。后端<strong>不做状态机校验</strong>，任何状态都能直接回写——
          正常情况应由外部执行方搬运完文件后调用，这里提供手动入口用于联调。
        </div>
        <label>
          目标状态
          <select v-model="statusForm.status">
            <option value="PROCESSING">PROCESSING</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
            <option value="PENDING">PENDING</option>
          </select>
        </label>
        <label>错误信息（FAILED 时建议填写）<input v-model="statusForm.errorMsg" placeholder="如 目标存储不可达" /></label>
        <div class="modal-actions">
          <button class="btn" @click="showStatusModal = false">取消</button>
          <button class="btn primary" @click="submitStatus">回写</button>
        </div>
      </div>
    </div>

    <!-- 清理 新建 -->
    <div class="modal-mask" v-if="showCleanupModal" @click.self="showCleanupModal = false">
      <div class="modal">
        <h3>新建清理请求</h3>
        <label>
          数据类型
          <select v-model="cleanupForm.dataType">
            <option value="RAW">RAW</option>
            <option value="DIFF">DIFF</option>
            <option value="FIELD">FIELD</option>
          </select>
        </label>
        <label>归档ID列表（逗号分隔）<input v-model="cleanupForm.archiveIds" placeholder="arc1,arc2" /></label>
        <label>文件数<input type="number" v-model.number="cleanupForm.fileCount" /></label>
        <label>操作人<input v-model="cleanupForm.operator" /></label>
        <label>原因<input v-model="cleanupForm.reason" placeholder="如 过期原始数据清理" /></label>
        <div class="modal-actions">
          <button class="btn" @click="showCleanupModal = false">取消</button>
          <button class="btn primary" @click="submitCleanup">创建</button>
        </div>
      </div>
    </div>

    <!-- 清理 审批 -->
    <div class="modal-mask" v-if="showApproveModal" @click.self="showApproveModal = false">
      <div class="modal">
        <h3>审批清理请求 · {{ approveTarget?.id }}</h3>
        <div class="modal-tip">
          接口 14 需要 <code>approvedBy</code>。审批通过后状态变为 APPROVED，仍不会删除任何文件。
        </div>
        <label>审批人<input v-model="approveBy" /></label>
        <div class="modal-actions">
          <button class="btn" @click="showApproveModal = false">取消</button>
          <button class="btn primary" @click="submitApprove">通过</button>
        </div>
      </div>
    </div>

    <!-- 存储 上报 -->
    <div class="modal-mask" v-if="showStorageModal" @click.self="showStorageModal = false">
      <div class="modal">
        <h3>上报存储指标</h3>
        <div class="modal-tip">接口 17 为 upsert：同一 storageType + mountPoint 会更新而非新增。</div>
        <label>
          类型
          <select v-model="storageForm.storageType">
            <option value="HOT">HOT</option>
            <option value="NEARLINE">NEARLINE</option>
            <option value="COLD">COLD</option>
          </select>
        </label>
        <label>挂载点<input v-model="storageForm.mountPoint" /></label>
        <div class="form-grid">
          <label>容量<input type="number" v-model.number="storageForm.capacity" /></label>
          <label>用量<input type="number" v-model.number="storageForm.usage" /></label>
          <label>IOPS<input type="number" v-model.number="storageForm.iops" /></label>
          <label>延迟(ms)<input type="number" v-model.number="storageForm.latency" /></label>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showStorageModal = false">取消</button>
          <button class="btn primary" @click="submitStorage">上报</button>
        </div>
      </div>
    </div>

    <!-- 详情 -->
    <div class="modal-mask" v-if="detail" @click.self="detail = null">
      <div class="modal wide">
        <h3>{{ detail.title }}</h3>
        <pre class="detail-pre">{{ detail.json }}</pre>
        <div class="modal-actions">
          <button class="btn" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
    <div v-if="loading" class="loading">加载中…</div>
  </div>
</template>

<style scoped>
.module-view { padding: 4px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.page-head h2 { font-size: 20px; margin: 0; }
.sub { font-size: 12px; color: #999; font-weight: 400; }

/* 错误面板：纯真实模式，后端报错必须暴露 */
.diag-panel { background: #fff2f0; border: 1px solid #ffccc7; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
.diag-title { color: #cf1322; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.diag-panel ul { margin: 0; padding-left: 18px; }
.diag-panel li { font-size: 12px; color: #a8071a; line-height: 1.8; word-break: break-all; }
.diag-hint { font-size: 12px; color: #cf1322; opacity: .8; margin-top: 6px; }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi-card { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px 18px; }
.kpi-num { font-size: 26px; font-weight: 700; color: #1890ff; }
.kpi-num.danger { color: #cf1322; }
.kpi-sub { font-size: 15px; font-weight: 500; color: #bbb; }
.kpi-label { font-size: 13px; color: #888; margin-top: 4px; }

.tab-bar { display: flex; gap: 6px; border-bottom: 1px solid #eee; margin-bottom: 14px; flex-wrap: wrap; }
.tab { border: none; background: transparent; padding: 10px 16px; cursor: pointer; font-size: 14px; color: #666; border-bottom: 2px solid transparent; }
.tab.active { color: #1890ff; border-bottom-color: #1890ff; font-weight: 600; }
.tab-panel { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px; }

.toolbar { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.toolbar select { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.total-hint { font-size: 12px; color: #999; margin-right: auto; }

.notice { background: #f0f5ff; border: 1px solid #d6e4ff; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #2f54eb; margin-bottom: 12px; line-height: 1.6; }
.warn-block { background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px; padding: 10px 12px; font-size: 12px; color: #ad6800; margin-bottom: 12px; line-height: 1.7; }
.warn-block .flow { margin-top: 4px; opacity: .85; font-family: ui-monospace, Consolas, monospace; }

.btn { border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.btn.primary { background: #1890ff; color: #fff; border-color: #1890ff; }
.btn.danger { color: #cf1322; border-color: #ffccc7; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn.sm.primary { background: #1890ff; color: #fff; border-color: #1890ff; }
.btn:disabled { opacity: .45; cursor: not-allowed; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { border-bottom: 1px solid #f0f0f0; padding: 9px 10px; text-align: left; }
.data-table th { background: #fafafa; color: #666; font-weight: 600; white-space: nowrap; }
.ops { white-space: nowrap; }
.ops .btn { margin-right: 4px; }
.err-cell { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cf1322; }
.empty { text-align: center; color: #bbb; padding: 24px; }

.tag { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.tag.ok { background: #f6ffed; color: #389e0d; }
.tag.bad { background: #fff2f0; color: #cf1322; }
.tag.warn { background: #fffbe6; color: #d48806; }
.tag.off { background: #f5f5f5; color: #8c8c8c; }
.tag.dt { background: #f0f5ff; color: #2f54eb; }

.ai-block { margin-bottom: 18px; }
.ai-block h3 { font-size: 15px; margin: 0 0 10px; }
.ai-item { border: 1px solid #eef0f3; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; line-height: 1.7; }
.ai-item.high { border-left: 3px solid #cf1322; }
.ai-item.medium { border-left: 3px solid #d48806; }
.ai-item.low { border-left: 3px solid #52c41a; }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 12px; padding: 22px; width: 400px; max-height: 86vh; overflow: auto; }
.modal.wide { width: 560px; }
.modal h3 { margin: 0 0 14px; }
.modal label { display: block; font-size: 13px; color: #555; margin-bottom: 10px; }
.modal label.inline { display: flex; align-items: center; gap: 6px; }
.modal label.inline input { width: auto; margin-top: 0; }
.modal input, .modal select { width: 100%; margin-top: 4px; padding: 7px; border: 1px solid #d9d9d9; border-radius: 6px; box-sizing: border-box; }
.modal input:disabled, .modal select:disabled { background: #f5f5f5; color: #999; }
.modal-tip { background: #f6f6f6; border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #666; line-height: 1.7; margin-bottom: 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

.real-warn { margin: 0 0 12px; padding: 10px 12px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px; font-size: 12px; color: #ad6800; line-height: 1.6; }
.detail-pre { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.6; max-height: 50vh; overflow: auto; margin: 0 0 12px; }

/* ===== MQ 联动视图 ===== */
.sec-title { font-size: 15px; margin: 22px 0 10px; color: #333; }
.sec-title:first-of-type { margin-top: 4px; }

.mq-graph { background: #fafbfc; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px; margin-bottom: 4px; }
.mq-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0; }
.mq-row + .mq-row { border-top: 1px dashed #e5e7eb; }
.mq-node {
  flex: 0 0 auto; padding: 7px 14px; border-radius: 8px; font-size: 13px;
  background: #fff; border: 1px solid #d9d9d9; color: #555;
}
.mq-node.ext { background: #f5f5f5; color: #8c8c8c; border-style: dashed; }
.mq-node.cur { background: #e6f7ff; border-color: #91d5ff; color: #096dd9; font-weight: 600; }
.mq-node.dim { opacity: .6; }
.mq-arrow {
  flex: 1 1 240px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 12px; border-radius: 8px; background: #f0f5ff; border: 1px solid #d6e4ff; min-width: 200px;
}
.mq-arrow.hot { background: #fff7e6; border-color: #ffd591; }
.mq-arrow b { font-size: 12px; color: #2f54eb; font-family: ui-monospace, Consolas, monospace; }
.mq-arrow.hot b { color: #d46b08; }
.mq-arrow em { font-size: 11px; color: #888; font-style: normal; }
.mq-arrow::after { content: '▶'; font-size: 10px; color: #bbb; }

.kpi-row.four .kpi-card, .kpi-row.five .kpi-card { padding: 12px 14px; }
.kpi-row.four .kpi-num, .kpi-row.five .kpi-num { font-size: 22px; }
.kpi-row.five { grid-template-columns: repeat(5, 1fr); }
.kpi-row.five .kpi-label { font-size: 12px; }
.ok-text { color: #389e0d; }
.bad-text { color: #cf1322; }
.kpi-num.muted { color: #8c8c8c; }
.muted-text { color: #bbb; font-size: 12px; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }

/* 入站消费三步 */
.steps { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.step { display: flex; gap: 10px; align-items: flex-start; background: #fafbfc; border: 1px solid #eef0f3; border-radius: 8px; padding: 10px 12px; }
.step-n {
  flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; background: #1890ff; color: #fff;
  font-size: 12px; display: flex; align-items: center; justify-content: center; font-weight: 700;
}
.step-title { font-size: 13px; font-weight: 600; color: #333; margin-bottom: 2px; }
.step-desc { font-size: 12px; color: #666; line-height: 1.6; }
.topic-action { font-size: 12px; color: #2f54eb; background: #f0f5ff; border-radius: 6px; padding: 6px 10px; margin-bottom: 8px; line-height: 1.6; }
.action-label { display: inline-block; background: #1890ff; color: #fff; border-radius: 4px; padding: 1px 6px; font-size: 11px; margin-right: 6px; }

.mig-chip {
  display: inline-block; margin-right: 6px; padding: 2px 8px; border-radius: 4px;
  background: #fafafa; border: 1px solid #eee; font-size: 11px; color: #666; white-space: nowrap;
}
.mig-chip b { margin-left: 4px; }

.topic-card { border: 1px solid #eef0f3; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.topic-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.topic-name { font-family: ui-monospace, Consolas, monospace; font-size: 14px; font-weight: 700; color: #1890ff; }
.topic-meta { font-size: 12px; color: #666; margin-bottom: 4px; }
.topic-note { font-size: 12px; color: #888; line-height: 1.6; margin-bottom: 10px; }
.schema-pre {
  background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 10px 12px;
  font-size: 12px; line-height: 1.6; margin: 0; overflow: auto;
  font-family: ui-monospace, Consolas, monospace;
}
.mapping { margin-top: 12px; }
.mapping-title { font-size: 12px; font-weight: 600; color: #555; margin-bottom: 6px; }
.data-table.compact { font-size: 12px; }
.data-table.compact th, .data-table.compact td { padding: 6px 8px; }

.toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 13px; z-index: 60; max-width: 60vw; }
.loading { position: fixed; top: 16px; right: 24px; color: #1890ff; font-size: 13px; }
</style>
