<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  metadataApi,
  consistencyCheck,
  SEMANTICS,
  type MetadataVO,
  type MetadataVersion,
  type MetadataStatistics,
  type SyncState,
  type DataType,
} from '@/api/modules/metadata'
// MS-10 归档服务：元数据入库的上游 —— archive 归档成功后会 HTTP 调 ingest 触发入库
import { archiveApi, type ArchiveRecord } from '@/api/modules/archive'
import ConnectionStatus from '@/components/ConnectionStatus.vue'

/** 单次拉取条数。后端数据量小，一次拉完即可。 */
const PAGE_SIZE = 100

const activeTab = ref('catalog')
const tabs = [
  { key: 'catalog', label: '📚 元数据库' },
  { key: 'ingest', label: '📥 入库' },
  { key: 'search', label: '🔍 检索' },
  { key: 'versions', label: '🕓 版本' },
  { key: 'sync', label: '🔄 ES同步' },
  { key: 'link', label: '🔗 HTTP 联动' },
  { key: 'ai', label: '🤖 一致性分析' },
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

// 元数据库列表 与 检索结果 分开存，避免检索把列表覆盖掉（旧版共用一个 ref 会互相污染）
const records = ref<MetadataVO[]>([])
const catalogTotal = ref(0)
const searchResults = ref<MetadataVO[]>([])
const searchTotal = ref(0)
const hasSearched = ref(false)

const stats = ref<MetadataStatistics | null>(null)
const syncState = ref<SyncState | null>(null)
const versions = ref<MetadataVersion[]>([])
const versionArchiveId = ref('')

// HTTP 联动：MS-10 归档记录
const archiveRecords = ref<ArchiveRecord[]>([])

// 检索表单
const searchForm = ref({ keyword: '', dataType: '' as DataType | '', stationId: '' })

// 入库弹窗
const showIngest = ref(false)
const ingestForm = ref({
  archiveId: '',
  dataType: 'RAW' as DataType,
  source: 'hmi',
  stationId: '',
  coordinateSystem: 'CGCS2000',
  resolution: 1,
  epochStart: 0,
  epochEnd: 0,
  fileCount: 1,
  totalSize: 0,
  tags: '' as string,
})

// 详情弹窗（接口 3）
const detail = ref<{ title: string; json: string } | null>(null)
async function showDetail(title: string, fn: () => Promise<{ data: unknown }>) {
  try {
    const r = await fn()
    detail.value = { title, json: JSON.stringify(r.data, null, 2) }
  } catch (e) {
    toast(`详情拉取失败：${errText(e)}`)
  }
}

// 标签编辑弹窗（接口 5）
const showTags = ref(false)
const tagsTarget = ref<MetadataVO | null>(null)
const tagsInput = ref('')
function openTags(m: MetadataVO) {
  tagsTarget.value = m
  tagsInput.value = (m.tags ?? []).join(', ')
  showTags.value = true
}

// ============ 数据加载 ============

async function loadCatalog() {
  const r = await metadataApi.search({ page: 1, size: PAGE_SIZE })
  // ⚠️ search 返回的是 { data: MetadataSearchResult, live }，不是裸的 PageResult —— 旧版漏了 .data 导致 5 个 TS 错误
  records.value = r.data.records
  catalogTotal.value = r.data.total
}
async function loadStats() {
  const r = await metadataApi.statistics()
  stats.value = r.data
}
async function loadSync() {
  const r = await metadataApi.syncState()
  syncState.value = r.data
}
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
    guard('元数据列表', loadCatalog),
    guard('统计概览', loadStats),
    guard('ES 同步状态', loadSync),
    guard('MS-10 归档记录（联动上游）', loadArchiveRecords),
  ])
  live.value = results.some(Boolean)
  loading.value = false
}

// ============ KPI & AI ============

const kpi = computed(() => ({
  total: stats.value?.totalCount ?? catalogTotal.value,
  es: stats.value?.esDocCount ?? 0,
  pg: stats.value?.pgCount ?? 0,
  missing: linkageStat.value.archiveOnly,
}))

const consistent = computed(() => (stats.value ? consistencyCheck(stats.value) : null))

// ============ HTTP 联动（MS-10 ↔ MS-12） ============

/**
 * 联动判读的三档结果。
 * 注意这条链路是 **HTTP** 不是 MQ —— MS-12 不消费任何 topic，
 * 元数据入库靠 archive(MS-10) 归档成功后主动 HTTP 调 POST /api/v1/metadata/ingest。
 */
type LinkState = 'BOTH' | 'ARCHIVE_ONLY' | 'META_ONLY'

interface LinkRow {
  archiveId: string
  dataType: string
  stationId: string
  fileSize: number
  metadata: MetadataVO | null
  state: LinkState
}

const linkage = computed<LinkRow[]>(() => {
  const metaByArchive = new Map<string, MetadataVO>()
  for (const m of records.value) metaByArchive.set(m.archiveId, m)

  const rows: LinkRow[] = []
  const seen = new Set<string>()

  for (const r of archiveRecords.value) {
    if (r.deleted) continue
    seen.add(r.id)
    const meta = metaByArchive.get(r.id) ?? null
    rows.push({
      archiveId: r.id,
      dataType: r.dataType,
      stationId: r.stationId ?? r.taskId ?? '-',
      fileSize: r.fileSize,
      metadata: meta,
      state: meta ? 'BOTH' : 'ARCHIVE_ONLY',
    })
  }
  // 元数据存在但归档记录已找不到 —— 归档被软删，或两服务数据不一致
  for (const m of records.value) {
    if (seen.has(m.archiveId)) continue
    rows.push({
      archiveId: m.archiveId,
      dataType: m.dataType,
      stationId: m.stationId ?? '-',
      fileSize: m.totalSize,
      metadata: m,
      state: 'META_ONLY',
    })
  }
  return rows
})

const linkageStat = computed(() => ({
  total: linkage.value.length,
  both: linkage.value.filter((r) => r.state === 'BOTH').length,
  archiveOnly: linkage.value.filter((r) => r.state === 'ARCHIVE_ONLY').length,
  metaOnly: linkage.value.filter((r) => r.state === 'META_ONLY').length,
}))

const LINK_LABEL: Record<LinkState, string> = {
  BOTH: '✅ 已入库',
  ARCHIVE_ONLY: '⚠️ 归档已存在但未入库',
  META_ONLY: '🔶 孤儿元数据（归档已不存在）',
}
const LINK_CLASS: Record<LinkState, string> = {
  BOTH: 'ok',
  ARCHIVE_ONLY: 'warn',
  META_ONLY: 'bad',
}

/**
 * 对「归档已存在但没入库」的记录补一次入库，真实调 MS-12 的 POST /ingest。
 * 效果等同于 archive 的自动调用，但必须说明前端不是消息的生产者。
 */
async function ingestFor(row: LinkRow) {
  const ok = confirm(
    `为归档 ${row.archiveId}（${row.dataType}）补入库？\n\n` +
      `⚠️ 这是人工补入库，会真实调用 MS-12 的 POST /api/v1/metadata/ingest。\n` +
      `它模拟的是 archive 归档成功后自动 HTTP 调用的效果 —— 但前端并不承担这个职责，\n` +
      `真实链路应由 archive 服务自己发起。补之前建议先确认为什么自动调用没成功。`,
  )
  if (!ok) return
  try {
    const src = archiveRecords.value.find((r) => r.id === row.archiveId)
    await metadataApi.ingest({
      archiveId: row.archiveId,
      dataType: row.dataType as DataType,
      source: 'hmi-manual',
      stationId: src?.stationId ?? src?.taskId ?? '',
      fileCount: 1,
      totalSize: row.fileSize,
    })
    toast('已补入库（真实写入 MS-12）')
    await guard('刷新元数据列表', loadCatalog)
  } catch (e) {
    toast(`补入库失败：${errText(e)}`)
  }
}

// ============ 写操作 ============

async function doSearch() {
  try {
    const r = await metadataApi.search({
      keyword: searchForm.value.keyword || undefined,
      dataType: (searchForm.value.dataType || undefined) as DataType | undefined,
      stationId: searchForm.value.stationId || undefined,
      page: 1,
      size: PAGE_SIZE,
    })
    searchResults.value = r.data.records
    searchTotal.value = r.data.total
    hasSearched.value = true
    toast(`检索到 ${r.data.total} 条`)
  } catch (e) {
    toast(`检索失败：${errText(e)}`)
  }
}

async function submitIngest() {
  if (!ingestForm.value.archiveId.trim()) {
    toast('归档ID必填')
    return
  }
  try {
    const f = ingestForm.value
    await metadataApi.ingest({
      archiveId: f.archiveId.trim(),
      dataType: f.dataType,
      source: f.source,
      stationId: f.stationId,
      coordinateSystem: f.coordinateSystem,
      resolution: f.resolution,
      epochStart: f.epochStart,
      epochEnd: f.epochEnd,
      fileCount: f.fileCount,
      totalSize: f.totalSize,
      tags: f.tags ? f.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
    toast('入库成功（PG + ES 双写）')
    showIngest.value = false
    await guard('刷新元数据列表', loadCatalog)
  } catch (e) {
    toast(`入库失败：${errText(e)}`)
  }
}

async function loadVersions() {
  if (!versionArchiveId.value.trim()) {
    toast('请输入归档ID')
    return
  }
  try {
    const r = await metadataApi.listVersions(versionArchiveId.value.trim(), { page: 1, size: 50 })
    versions.value = r.data.records
    toast(`版本数：${r.data.total}`)
  } catch (e) {
    toast(`版本拉取失败：${errText(e)}`)
  }
}

async function submitTags() {
  const t = tagsTarget.value
  if (!t) return
  try {
    const tags = tagsInput.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await metadataApi.updateTags(t.archiveId, tags)
    toast('标签已更新（PG + ES）')
    showTags.value = false
    await guard('刷新元数据列表', loadCatalog)
  } catch (e) {
    toast(`更新失败：${errText(e)}`)
  }
}

async function softDelete(id: string) {
  if (!confirm(`确认软删除归档 ${id} 的元数据？\n\n${SEMANTICS.softDelete}`)) return
  try {
    await metadataApi.softDelete(id)
    toast('已软删除')
    await guard('刷新元数据列表', loadCatalog)
  } catch (e) {
    toast(`删除失败：${errText(e)}`)
  }
}

async function triggerSync() {
  if (!confirm(`确认触发全量同步？\n\n${SEMANTICS.syncTrigger}`)) return
  try {
    await metadataApi.syncTrigger()
    toast('已触发全量同步（注意 ES 三字段已被清空）')
    await guard('刷新同步状态', loadSync)
  } catch (e) {
    toast(`触发失败：${errText(e)}`)
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
    <!-- MS-12 的 10 个接口里没有 health 端点，只能用业务端点做在线探针 -->
    <ConnectionStatus
      service-name="元数据服务（MS-12）"
      :port="18092"
      health-path="/api/v1/metadata/statistics"
      mode="real"
    />

    <div class="page-head">
      <h2>📊 元数据管理 <span class="sub">MS-12 · bd-metadata-service · 18092</span></h2>
      <button class="btn" :disabled="loading" @click="loadAll">{{ loading ? '刷新中…' : '刷新' }}</button>
    </div>

    <!-- 后端原始错误：纯真实模式，绝不用演示数据兜底 -->
    <div v-if="errors.length" class="diag-panel">
      <div class="diag-title">⚠ 后端接口异常（未做任何降级，以下为后端原始报错）</div>
      <ul>
        <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
      </ul>
      <div class="diag-hint">
        纯真实模式：接口失败时不会填充任何演示数据。请确认 18092 服务已启动，或点击上方状态条的「重试」。
      </div>
    </div>

    <!-- KPI -->
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-num">{{ kpi.total }}</div>
        <div class="kpi-label">元数据总量</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ kpi.es }}</div>
        <div class="kpi-label">ES 文档数</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ kpi.pg }}</div>
        <div class="kpi-label">PG 记录数</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" :class="{ danger: kpi.missing > 0 }">{{ kpi.missing }}</div>
        <div class="kpi-label">归档未入库</div>
      </div>
    </div>

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

    <!-- ============ 元数据库 ============ -->
    <section v-show="activeTab === 'catalog'" class="tab-panel">
      <div class="toolbar">
        <span class="total-hint">共 {{ catalogTotal }} 条{{ catalogTotal > PAGE_SIZE ? `（显示前 ${PAGE_SIZE} 条）` : '' }}</span>
        <button class="btn primary" @click="showIngest = true">+ 元信息入库</button>
      </div>
      <div class="notice">{{ SEMANTICS.dualWrite }}</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>归档ID</th><th>类型</th><th>测站</th><th>坐标系</th><th>文件数</th><th>总大小</th><th>标签</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td class="mono">{{ r.archiveId }}</td>
            <td><span class="tag dt">{{ r.dataType }}</span></td>
            <td>{{ r.stationId || '—' }}</td>
            <td>{{ r.coordinateSystem }}</td>
            <td>{{ r.fileCount }}</td>
            <td>{{ r.totalSize }}</td>
            <td>
              <span v-if="!r.tags || !r.tags.length" class="muted-text">—</span>
              <span v-for="t in r.tags" :key="t" class="tag-chip">{{ t }}</span>
            </td>
            <td class="ops">
              <button class="btn sm" @click="showDetail(`元数据详情 · ${r.archiveId}`, () => metadataApi.getDetail(r.archiveId))">
                详情
              </button>
              <button class="btn sm" @click="openTags(r)">标签</button>
              <button class="btn sm danger" @click="softDelete(r.archiveId)">删除</button>
            </td>
          </tr>
          <tr v-if="!records.length">
            <td colspan="8" class="empty">暂无数据（可点「元信息入库」写入真实数据，或由 archive 归档后自动入库）</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ 入库 ============ -->
    <section v-show="activeTab === 'ingest'" class="tab-panel">
      <h3 class="sec-title">入库是怎么被触发的</h3>
      <div class="warn-block">
        <b>{{ SEMANTICS.ingest }}</b>
      </div>
      <div class="mq-graph">
        <div class="mq-row">
          <span class="mq-node">archive 归档服务 · MS-10</span>
          <span class="mq-arrow hot">
            <b>POST /api/v1/metadata/ingest</b>
            <em>HTTP（不是 MQ）</em>
          </span>
          <span class="mq-node cur">metadata 元数据服务 · MS-12（本页）</span>
        </div>
      </div>
      <div class="notice">
        ⚠️ 与 archive / lifecycle 不同，<b>MS-12 不消费任何 MQ topic</b>，
        它和上游之间没有任何消息队列耦合，全靠上面这条 HTTP 调用。
      </div>
      <button class="btn primary" @click="showIngest = true">+ 手动入库（联调用）</button>
      <div class="hint">
        手动入库是为了联调时造数据。<b>正常业务流程里前端不该调它</b> —— 入库由 archive 自动发起。
      </div>
    </section>

    <!-- ============ 检索 ============ -->
    <section v-show="activeTab === 'search'" class="tab-panel">
      <div class="toolbar">
        <input v-model="searchForm.keyword" placeholder="关键字" />
        <select v-model="searchForm.dataType">
          <option value="">全部类型</option>
          <option value="RAW">RAW</option>
          <option value="DIFF">DIFF</option>
          <option value="FIELD">FIELD</option>
        </select>
        <input v-model="searchForm.stationId" placeholder="测站ID" />
        <button class="btn primary" @click="doSearch">检索</button>
      </div>
      <div class="notice">检索走 ES 优先、PG 回退。检索结果独立于「元数据库」列表，不会互相覆盖。</div>
      <table class="data-table">
        <thead>
          <tr><th>归档ID</th><th>类型</th><th>测站</th><th>坐标系</th><th>文件数</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in searchResults" :key="r.id">
            <td class="mono">{{ r.archiveId }}</td>
            <td><span class="tag dt">{{ r.dataType }}</span></td>
            <td>{{ r.stationId || '—' }}</td>
            <td>{{ r.coordinateSystem }}</td>
            <td>{{ r.fileCount }}</td>
            <td class="ops">
              <button class="btn sm" @click="showDetail(`元数据详情 · ${r.archiveId}`, () => metadataApi.getDetail(r.archiveId))">
                详情
              </button>
            </td>
          </tr>
          <tr v-if="!searchResults.length">
            <td colspan="6" class="empty">{{ hasSearched ? '无结果' : '输入条件后点「检索」' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="hasSearched" class="total-hint">共 {{ searchTotal }} 条</div>
    </section>

    <!-- ============ 版本 ============ -->
    <section v-show="activeTab === 'versions'" class="tab-panel">
      <div class="toolbar">
        <input v-model="versionArchiveId" placeholder="归档ID" />
        <button class="btn primary" @click="loadVersions">查版本</button>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>版本ID</th><th>版本号</th><th>变更类型</th><th>操作人</th><th>详情</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td class="mono">{{ v.id }}</td>
            <td>{{ v.version }}</td>
            <td><span class="tag" :class="v.changeType === 'DELETE' ? 'bad' : v.changeType === 'UPDATE' ? 'warn' : 'ok'">{{ v.changeType }}</span></td>
            <td>{{ v.operator }}</td>
            <td class="err-cell" :title="v.changeDetail">{{ v.changeDetail }}</td>
            <td class="ops">
              <button
                class="btn sm"
                @click="showDetail(`版本详情 · v${v.version}`, () => metadataApi.getVersionDetail(versionArchiveId, v.id))"
              >
                详情
              </button>
            </td>
          </tr>
          <tr v-if="!versions.length">
            <td colspan="6" class="empty">输入归档ID后点「查版本」</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ ES 同步 ============ -->
    <section v-show="activeTab === 'sync'" class="tab-panel">
      <div v-if="syncState" class="sync-box">
        <p>同步目标：<b>{{ syncState.syncTarget }}</b></p>
        <p>状态：<span class="tag" :class="syncState.status === 'SYNCED' ? 'ok' : 'warn'">{{ syncState.status }}</span></p>
        <p>待同步数：<b>{{ syncState.pendingCount }}</b></p>
        <p>上次同步：{{ syncState.lastSyncTime || '—' }}</p>
        <p>上次同步ID：<span class="mono">{{ syncState.lastSyncId || '—' }}</span></p>
      </div>
      <div v-else class="empty">暂无同步状态（后端未启动或接口异常）</div>
      <div class="warn-block"><b>🔴 {{ SEMANTICS.syncTrigger }}</b></div>
      <button class="btn primary" @click="triggerSync">触发全量同步</button>

      <h3 class="sec-title">出站 MQ（本服务唯一的消息）</h3>
      <div class="topic-card">
        <div class="topic-head">
          <span class="topic-name">bd3.log.audit</span>
          <span class="tag ok">出站</span>
          <span class="tag ok">本组设计完成（待 sign-off）</span>
        </div>
        <div class="topic-meta">metadata（MS-12） → log（MS-16）写入 · tag: *</div>
        <div class="topic-note">
          module 固定为 <code>METADATA</code>（MS-10 投递同一 topic 时用 <code>ARCHIVE</code>，MS-11 用 <code>LIFECYCLE</code>）。
        </div>
        <pre class="schema-pre">{{ JSON.stringify(
          { schemaVersion: 'v0.1', module: 'METADATA', operation: '', userId: '', username: '', success: true, params: '', result: '', timestamp: 0 },
          null,
          2,
        ) }}</pre>
        <div class="notice">
          这是<b>契约文本</b>，不是运行时数据 —— 浏览器拿不到 MQ 消息，这里只作联调核对字段用。
        </div>
      </div>
    </section>

    <!-- ============ HTTP 联动 ============ -->
    <section v-show="activeTab === 'link'" class="tab-panel">
      <div class="notice">
        <b>这里是 HTTP 联动，不是 MQ 联动。</b>
        MS-12 <b>不消费任何 MQ topic</b>，与上游之间全靠 archive 主动调
        <code>POST /api/v1/metadata/ingest</code>。下面的比对用的是
        <b>MS-10 的真实归档记录</b>与<b>MS-12 的真实元数据</b>。
      </div>

      <div class="kpi-row four">
        <div class="kpi-card">
          <div class="kpi-num">{{ linkageStat.total }}</div>
          <div class="kpi-label">比对总行数</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num ok-text">{{ linkageStat.both }}</div>
          <div class="kpi-label">已入库</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num" :class="{ danger: linkageStat.archiveOnly > 0 }">{{ linkageStat.archiveOnly }}</div>
          <div class="kpi-label">归档未入库</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num" :class="{ danger: linkageStat.metaOnly > 0 }">{{ linkageStat.metaOnly }}</div>
          <div class="kpi-label">孤儿元数据</div>
        </div>
      </div>

      <div class="warn-block">
        <b>怎么读这张表：</b>匹配键是 <code>archiveId</code>。
        ⚠️ 字段名不一致 —— MS-10 归档记录的主键在 HTTP 响应里叫
        <code>id</code>，MS-12 元数据里叫 <code>archiveId</code>，指的是同一个值。
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>归档ID（= 元数据 archiveId）</th><th>数据类型</th><th>测站</th><th>大小</th>
            <th>判读</th><th>元数据坐标系</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in linkage" :key="row.archiveId">
            <td class="mono">{{ row.archiveId }}</td>
            <td><span class="tag dt">{{ row.dataType }}</span></td>
            <td>{{ row.stationId }}</td>
            <td>{{ row.fileSize }}</td>
            <td><span class="tag" :class="LINK_CLASS[row.state]">{{ LINK_LABEL[row.state] }}</span></td>
            <td>{{ row.metadata?.coordinateSystem ?? '—' }}</td>
            <td class="ops">
              <button v-if="row.state === 'ARCHIVE_ONLY'" class="btn sm" @click="ingestFor(row)">补入库</button>
              <button
                v-else-if="row.metadata"
                class="btn sm"
                @click="showDetail(`元数据详情 · ${row.archiveId}`, () => metadataApi.getDetail(row.archiveId))"
              >
                详情
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!linkage.length">
            <td colspan="7" class="empty">
              两侧都没有数据。MS-10 或 MS-12 未启动，或尚未归档 —— 归档成功后 archive 会自动 HTTP 调 ingest。
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ 一致性分析 ============ -->
    <section v-show="activeTab === 'ai'" class="tab-panel">
      <div v-if="consistent" class="ai-item" :class="consistent.consistent ? 'low' : 'high'">
        <b>PG/ES 一致性：{{ consistent.consistent ? '一致' : '存在差异' }}</b><br />
        <small>gap = {{ consistent.gap }}。{{ consistent.advice }}</small>
      </div>
      <div v-else class="empty">暂无统计数据时无法评估一致性（后端未启动）</div>

      <div v-if="stats" class="ai-item low">
        <b>统计概览</b><br />
        <small>
          总量 {{ stats.totalCount }}；按类型
          {{ stats.byDataType.map((d) => `${d.dataType}:${d.count}`).join('，') || '无' }}
        </small>
      </div>

      <div class="ai-item" :class="linkageStat.archiveOnly > 0 ? 'high' : 'low'">
        <b>入库完整性</b><br />
        <small>
          归档记录 {{ linkageStat.both + linkageStat.archiveOnly }} 条中，已入库 {{ linkageStat.both }} 条，
          未入库 {{ linkageStat.archiveOnly }} 条。
          {{
            linkageStat.archiveOnly > 0
              ? '存在归档未入库，说明 archive 的自动 HTTP 调用没有全部成功，建议排查 MS-10 侧日志。'
              : '所有归档都已完成元数据入库。'
          }}
        </small>
      </div>

      <div class="notice">以上分析由前端基于当前页面的真实数据实时计算，不产生任何后端写入。</div>
    </section>

    <!-- ============ 弹窗 ============ -->

    <!-- 入库 -->
    <div class="modal-mask" v-if="showIngest" @click.self="showIngest = false">
      <div class="modal">
        <h3>元信息入库</h3>
        <div class="modal-tip">{{ SEMANTICS.dualWrite }}</div>
        <label>归档ID *<input v-model="ingestForm.archiveId" placeholder="必填" /></label>
        <label>
          数据类型 *
          <select v-model="ingestForm.dataType">
            <option value="RAW">RAW</option>
            <option value="DIFF">DIFF</option>
            <option value="FIELD">FIELD</option>
          </select>
        </label>
        <label>来源<input v-model="ingestForm.source" /></label>
        <label>测站ID<input v-model="ingestForm.stationId" /></label>
        <label>坐标系<input v-model="ingestForm.coordinateSystem" /></label>
        <div class="form-grid">
          <label>文件数<input type="number" v-model.number="ingestForm.fileCount" /></label>
          <label>总大小<input type="number" v-model.number="ingestForm.totalSize" /></label>
          <label>历元起<input type="number" v-model.number="ingestForm.epochStart" /></label>
          <label>历元止<input type="number" v-model.number="ingestForm.epochEnd" /></label>
        </div>
        <label>标签（逗号分隔）<input v-model="ingestForm.tags" placeholder="如 tag1,tag2" /></label>
        <div class="modal-actions">
          <button class="btn" @click="showIngest = false">取消</button>
          <button class="btn primary" @click="submitIngest">入库</button>
        </div>
      </div>
    </div>

    <!-- 标签编辑 -->
    <div class="modal-mask" v-if="showTags" @click.self="showTags = false">
      <div class="modal">
        <h3>更新标签 · {{ tagsTarget?.archiveId }}</h3>
        <div class="modal-tip">接口 5：更新标签会同时写 PG 与 ES。</div>
        <label>标签（逗号分隔，清空即删除全部标签）<input v-model="tagsInput" placeholder="如 tag1,tag2" /></label>
        <div class="modal-actions">
          <button class="btn" @click="showTags = false">取消</button>
          <button class="btn primary" @click="submitTags">保存</button>
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

.diag-panel { background: #fff2f0; border: 1px solid #ffccc7; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
.diag-title { color: #cf1322; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.diag-panel ul { margin: 0; padding-left: 18px; }
.diag-panel li { font-size: 12px; color: #a8071a; line-height: 1.8; word-break: break-all; }
.diag-hint { font-size: 12px; color: #cf1322; opacity: .8; margin-top: 6px; }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi-row.four { grid-template-columns: repeat(4, 1fr); }
.kpi-card { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px 18px; }
.kpi-num { font-size: 26px; font-weight: 700; color: #1890ff; }
.kpi-num.danger { color: #cf1322; }
.kpi-label { font-size: 13px; color: #888; margin-top: 4px; }

.tab-bar { display: flex; gap: 6px; border-bottom: 1px solid #eee; margin-bottom: 14px; flex-wrap: wrap; }
.tab { border: none; background: transparent; padding: 10px 14px; cursor: pointer; font-size: 14px; color: #666; border-bottom: 2px solid transparent; }
.tab.active { color: #1890ff; border-bottom-color: #1890ff; font-weight: 600; }
.tab-panel { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px; }

.sec-title { font-size: 15px; margin: 18px 0 10px; color: #333; }
.sec-title:first-of-type { margin-top: 4px; }

.toolbar { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.toolbar input, .toolbar select { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.total-hint { font-size: 12px; color: #999; margin-right: auto; }

.notice { background: #f0f5ff; border: 1px solid #d6e4ff; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #2f54eb; margin-bottom: 12px; line-height: 1.6; }
.warn-block { background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px; padding: 10px 12px; font-size: 12px; color: #ad6800; margin-bottom: 12px; line-height: 1.7; }
.hint { font-size: 12px; color: #888; margin-top: 10px; background: #fafafa; padding: 8px 12px; border-radius: 6px; line-height: 1.6; }

.btn { border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.btn.primary { background: #1890ff; color: #fff; border-color: #1890ff; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn.danger { color: #cf1322; border-color: #ffccc7; }
.btn:disabled { opacity: .45; cursor: not-allowed; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { border-bottom: 1px solid #f0f0f0; padding: 9px 10px; text-align: left; }
.data-table th { background: #fafafa; color: #666; font-weight: 600; white-space: nowrap; }
.ops { white-space: nowrap; }
.ops .btn { margin-right: 4px; }
.err-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { text-align: center; color: #bbb; padding: 24px; }

.tag { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.tag.ok { background: #f6ffed; color: #389e0d; }
.tag.bad { background: #fff2f0; color: #cf1322; }
.tag.warn { background: #fffbe6; color: #d48806; }
.tag.dt { background: #f0f5ff; color: #2f54eb; }
.tag-chip { display: inline-block; margin-right: 4px; padding: 1px 7px; border-radius: 4px; background: #fafafa; border: 1px solid #eee; font-size: 11px; color: #666; }
.ok-text { color: #389e0d; }
.muted-text { color: #bbb; font-size: 12px; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }

.mq-graph { background: #fafbfc; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
.mq-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 4px 0; }
.mq-node { flex: 0 0 auto; padding: 7px 14px; border-radius: 8px; font-size: 13px; background: #fff; border: 1px solid #d9d9d9; color: #555; }
.mq-node.cur { background: #e6f7ff; border-color: #91d5ff; color: #096dd9; font-weight: 600; }
.mq-arrow { flex: 1 1 240px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 12px; border-radius: 8px; background: #fff7e6; border: 1px solid #ffd591; min-width: 220px; }
.mq-arrow b { font-size: 12px; color: #d46b08; font-family: ui-monospace, Consolas, monospace; }
.mq-arrow em { font-size: 11px; color: #888; font-style: normal; }
.mq-arrow::after { content: '▶'; font-size: 10px; color: #bbb; }

.topic-card { border: 1px solid #eef0f3; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.topic-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.topic-name { font-family: ui-monospace, Consolas, monospace; font-size: 14px; font-weight: 700; color: #1890ff; }
.topic-meta { font-size: 12px; color: #666; margin-bottom: 4px; }
.topic-note { font-size: 12px; color: #888; line-height: 1.6; margin-bottom: 10px; }
.schema-pre { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.6; margin: 0 0 10px; overflow: auto; font-family: ui-monospace, Consolas, monospace; }

.sync-box { background: #fafafa; border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 13px; }
.sync-box p { margin: 4px 0; }

.ai-item { border: 1px solid #eef0f3; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; line-height: 1.7; }
.ai-item.high { border-left: 3px solid #cf1322; }
.ai-item.low { border-left: 3px solid #52c41a; }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 12px; padding: 22px; width: 400px; max-height: 86vh; overflow: auto; }
.modal.wide { width: 560px; }
.modal h3 { margin: 0 0 14px; }
.modal label { display: block; font-size: 13px; color: #555; margin-bottom: 10px; }
.modal input, .modal select { width: 100%; margin-top: 4px; padding: 7px; border: 1px solid #d9d9d9; border-radius: 6px; box-sizing: border-box; }
.modal-tip { background: #f6f6f6; border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #666; line-height: 1.7; margin-bottom: 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

.detail-pre { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.6; max-height: 50vh; overflow: auto; margin: 0 0 12px; }

.toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 13px; z-index: 60; max-width: 60vw; }
.loading { position: fixed; top: 16px; right: 24px; color: #1890ff; font-size: 13px; }
</style>
