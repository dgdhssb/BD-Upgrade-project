<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { casterApi, type MountpointStats, type ClientView, type CasterEventVO } from '@/api/modules/caster'

import ConnectionStatus from '@/components/ConnectionStatus.vue'

// ============ 状态 ============
const loading = ref(false)
const lastUpdated = ref('')
const toast = reactive({ show: false, msg: '', type: 'info' as 'info' | 'success' | 'error' })

// 监控运维
const casterStatus = ref<any>(null)
const health = ref<any>(null)
const info = ref<any>(null)
const events = ref<CasterEventVO[]>([])
const alerts = ref<CasterEventVO[]>([])

// 挂载点
const mountpoints = ref<MountpointStats[]>([])
const mpTotal = ref(0)
const mpPage = ref(1)
const mpSize = ref(100)

// 客户端
const clients = ref<ClientView[]>([])
const clientFilter = ref('')

// 播发统计（逐个挂载点）
const mpStats = ref<MountpointStats[]>([])

// 播发 / 模拟器
const sourcetable = ref('')
const simulatorStatus = ref<Record<string, boolean>>({})
const injectForm = reactive({ mountpoint: '', data: '', encoding: 'hex', times: 1 })
const simForm = reactive({ mountpoint: '', intervalMs: 1000, frameTypes: '1005,1077' })
const showInjectModal = ref(false)
const showSimModal = ref(false)

// 新建 / 编辑挂载点
const showMpModal = ref(false)
const editingMp = ref<string | null>(null)
const mpForm = reactive({
  name: '',
  format: 'RTCM3',
  system: 'GPS+BDS',
  sourceDescription: '',
  authRequired: true,
  username: '',
  password: '',
  enabled: true,
})

// SSE 实时事件
const sseEvents = ref<CasterEventVO[]>([])
let es: EventSource | null = null

// ============ 计算 ============
const kpis = computed(() => {
  const s = casterStatus.value || {}
  return [
    { label: 'Caster 状态', value: s.status === 'RUNNING' ? '运行中' : (s.status || '—'), tone: s.status === 'RUNNING' ? 'up' : 'down' },
    { label: '挂载点总数', value: s.totalMountpoints ?? 0, tone: 'normal' },
    { label: '启用挂载点', value: s.enabledMountpoints ?? 0, tone: 'normal' },
    { label: '客户端总数', value: s.totalClients ?? 0, tone: 'normal' },
    { label: '订阅者数', value: s.subscriberCount ?? 0, tone: 'up' },
    { label: '数据源数', value: s.sourceCount ?? 0, tone: 'normal' },
    { label: '累计播发帧数', value: fmtNum(s.totalSentFrames ?? 0), tone: 'normal' },
    { label: '累计播发字节', value: fmtBytes(s.totalSentBytes ?? 0), tone: 'normal' },
  ]
})

const filteredClients = computed(() => {
  if (!clientFilter.value) return clients.value
  return clients.value.filter((c) => c.mountpoint === clientFilter.value)
})

const aiInsights = computed(() => {
  const out: string[] = []
  const s = casterStatus.value
  if (!s) return ['尚未获取到 Caster 状态，请确认后端 18088 已启动。']
  if (s.status !== 'RUNNING') out.push('⚠️ Caster 当前未运行（' + (s.status || '未知') + '），无法对外播发 RTCM 数据。')
  if (s.enabledMountpoints === 0) out.push('⚠️ 无启用的挂载点，订阅端连接后会立即被拒绝，建议先启用至少一个挂载点。')
  if (s.sourceCount === 0) out.push('ℹ️ 当前无活跃数据源（SOURCE），挂载点虽启用但不会向订阅者推送任何帧。')
  if (s.totalClients > 0 && s.subscriberCount === 0) out.push('ℹ️ 存在客户端连接但无订阅者，可能均为 SOURCE 上传端。')
  if (typeof s.byteRate === 'number' && s.byteRate > 0) out.push('✅ 播发速率正常：' + fmtBytes(s.byteRate) + '/s。')
  const authFail = (mountpoints.value || []).reduce((a, m) => a + (m.authFailures || 0), 0)
  if (authFail > 0) out.push('⚠️ 累计认证失败 ' + authFail + ' 次，存在异常接入尝试，建议检查挂载点凭据。')
  if (out.length === 0) out.push('✅ 播发服务运行平稳，挂载点、数据源与订阅者均正常。')
  return out
})

// ============ 工具 ============
function fmtNum(n: number): string {
  return (n ?? 0).toLocaleString('en-US')
}
function fmtBytes(n: number): string {
  n = n || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  toast.msg = msg
  toast.type = type
  toast.show = true
  setTimeout(() => (toast.show = false), 2600)
}
function levelTone(level?: string): string {
  if (level === 'ERROR') return 'error'
  if (level === 'WARN') return 'warn'
  return 'info'
}

// ============ 数据加载 ============
async function loadStatus() {
  try {
    const s = await casterApi.getStatus()
    casterStatus.value = s
    if (s?.mountpoints) mpStats.value = s.mountpoints
  } catch (e: any) {
    showToast('状态加载失败：' + e.message, 'error')
  }
}
async function loadHealth() {
  try {
    health.value = await casterApi.getHealth()
  } catch {
    /* 忽略 */
  }
}
async function loadInfo() {
  try {
    info.value = await casterApi.getInfo()
  } catch {
    /* 忽略 */
  }
}
async function loadEvents() {
  try {
    events.value = await casterApi.listEvents(50)
  } catch {
    /* 忽略 */
  }
  try {
    alerts.value = await casterApi.listAlerts(50)
  } catch {
    /* 忽略 */
  }
}
async function loadMountpoints() {
  try {
    const r = await casterApi.listMountpoints(mpPage.value, mpSize.value)
    mountpoints.value = r.content || []
    mpTotal.value = r.total ?? r.totalElements ?? (r.content || []).length
  } catch (e: any) {
    showToast('挂载点加载失败：' + e.message, 'error')
  }
}
async function loadClients() {
  try {
    clients.value = await casterApi.listClients()
  } catch (e: any) {
    showToast('客户端加载失败：' + e.message, 'error')
  }
}
async function loadSourcetable() {
  try {
    sourcetable.value = await casterApi.getSourcetable()
  } catch (e: any) {
    showToast('SOURCETABLE 加载失败：' + e.message, 'error')
  }
}
async function loadSimulator() {
  try {
    simulatorStatus.value = (await casterApi.getSimulatorStatus()) as Record<string, boolean>
  } catch {
    /* 忽略 */
  }
}

async function loadAll() {
  loading.value = true
  await Promise.allSettled([
    loadStatus(),
    loadHealth(),
    loadInfo(),
    loadEvents(),
    loadMountpoints(),
    loadClients(),
    loadSourcetable(),
    loadSimulator(),
  ])
  lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  loading.value = false
}

// ============ 操作 ============
function openMpModal(mp?: MountpointStats) {
  if (mp) {
    editingMp.value = mp.name || null
    Object.assign(mpForm, {
      name: mp.name || '',
      format: mp.format || 'RTCM3',
      system: mp.system || 'GPS+BDS',
      sourceDescription: mp.sourceDescription || '',
      authRequired: true,
      username: '',
      password: '',
      enabled: mp.enabled ?? true,
    })
  } else {
    editingMp.value = null
    Object.assign(mpForm, {
      name: '',
      format: 'RTCM3',
      system: 'GPS+BDS',
      sourceDescription: '',
      authRequired: true,
      username: '',
      password: '',
      enabled: true,
    })
  }
  showMpModal.value = true
}
async function saveMp() {
  try {
    await casterApi.createMountpoint({
      name: mpForm.name,
      format: mpForm.format,
      system: mpForm.system,
      sourceDescription: mpForm.sourceDescription,
      authRequired: mpForm.authRequired,
      username: mpForm.username || undefined,
      password: mpForm.password || undefined,
      enabled: mpForm.enabled,
    })
    showToast('挂载点已创建', 'success')
    showMpModal.value = false
    await loadMountpoints()
  } catch (e: any) {
    showToast('创建失败：' + e.message, 'error')
  }
}
async function toggleMp(mp: MountpointStats) {
  try {
    if (mp.enabled) await casterApi.disableMountpoint(mp.name!)
    else await casterApi.enableMountpoint(mp.name!)
    showToast(mp.enabled ? '已禁用' : '已启用', 'success')
    await loadMountpoints()
    await loadStatus()
  } catch (e: any) {
    showToast('操作失败：' + e.message, 'error')
  }
}
async function removeMp(mp: MountpointStats) {
  if (!confirm('确认删除挂载点「' + mp.name + '」？')) return
  try {
    await casterApi.deleteMountpoint(mp.name!)
    showToast('已删除', 'success')
    await loadMountpoints()
  } catch (e: any) {
    showToast('删除失败：' + e.message, 'error')
  }
}
async function kickClient(c: ClientView) {
  if (!confirm('确认踢出客户端 ' + (c.id || c.remoteAddress) + '？')) return
  try {
    await casterApi.kickClient(c.id!)
    showToast('已踢出', 'success')
    await loadClients()
  } catch (e: any) {
    showToast('踢出失败：' + e.message, 'error')
  }
}
async function submitInject() {
  try {
    await casterApi.injectBroadcast({
      mountpoint: injectForm.mountpoint,
      data: injectForm.data,
      encoding: injectForm.encoding,
      times: injectForm.times,
    })
    showToast('数据已注入播发', 'success')
    showInjectModal.value = false
    await loadStatus()
  } catch (e: any) {
    showToast('注入失败：' + e.message, 'error')
  }
}
async function startSim() {
  try {
    await casterApi.startSimulator({
      mountpoint: simForm.mountpoint,
      intervalMs: simForm.intervalMs,
      frameTypes: simForm.frameTypes,
    })
    showToast('模拟数据源已启动', 'success')
    showSimModal.value = false
    await loadSimulator()
  } catch (e: any) {
    showToast('启动失败：' + e.message, 'error')
  }
}
async function stopSim(name: string) {
  try {
    await casterApi.stopSimulator(name)
    showToast('模拟数据源已停止', 'success')
    await loadSimulator()
  } catch (e: any) {
    showToast('停止失败：' + e.message, 'error')
  }
}

// ============ SSE ============
function connectSse() {
  if (es) return
  try {
    es = new EventSource(casterApi.streamUrl())
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data)
        sseEvents.value.unshift(e)
        if (sseEvents.value.length > 50) sseEvents.value.pop()
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      /* SSE 断线由浏览器自动重连 */
    }
  } catch {
    /* ignore */
  }
}
function closeSse() {
  if (es) {
    es.close()
    es = null
  }
}

// ============ 生命周期 ============
let timer: number | undefined
onMounted(() => {
  loadAll()
  connectSse()
  timer = window.setInterval(loadAll, 30000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  closeSse()
})

const activeTab = ref('monitor')
</script>

<template>
  <div class="module-view">
    <ConnectionStatus service-name="NTRIP播发服务" :port="18088" health-path="/api/v1/ntrip-caster/health" mode="real" />
    <!-- 顶部标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-title">NTRIP 播发服务 · AI</h1>
        <p class="page-sub">MS-08 ntrip-caster-service ｜ Netty TCP 2101 多挂载点 RTCM3 播发 ｜ 端口 18088</p>
      </div>
      <div class="head-actions">
        <span class="updated">更新于 {{ lastUpdated || '—' }}</span>
        <button class="btn btn-primary" @click="loadAll" :disabled="loading">刷新</button>
      </div>
    </div>

    <!-- KPI 卡片 -->
    <div class="kpi-row">
      <div class="kpi-card" v-for="k in kpis" :key="k.label">
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-value" :class="'tone-' + k.tone">{{ k.value }}</div>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'monitor' }" @click="activeTab = 'monitor'">监控运维</button>
      <button class="tab" :class="{ active: activeTab === 'mountpoint' }" @click="activeTab = 'mountpoint'">挂载点管理</button>
      <button class="tab" :class="{ active: activeTab === 'client' }" @click="activeTab = 'client'">客户端管理</button>
      <button class="tab" :class="{ active: activeTab === 'stats' }" @click="activeTab = 'stats'">播发统计</button>
      <button class="tab" :class="{ active: activeTab === 'broadcast' }" @click="activeTab = 'broadcast'">数据播发</button>
    </div>

    <!-- Tab: 监控运维 -->
    <section v-show="activeTab === 'monitor'" class="tab-panel">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">整体状态</div>
          <div class="kv" v-if="casterStatus">
            <div><span>服务状态</span><b :class="casterStatus.status === 'RUNNING' ? 'up' : 'down'">{{ casterStatus.status }}</b></div>
            <div><span>HTTP 端口</span><b>{{ casterStatus.httpPort }}</b></div>
            <div><span>TCP 端口</span><b>{{ casterStatus.tcpPort }}</b></div>
            <div><span>运行时长</span><b>{{ casterStatus.uptimeSeconds }}s</b></div>
            <div><span>帧速率</span><b>{{ casterStatus.frameRate }} 帧/s</b></div>
            <div><span>字节速率</span><b>{{ fmtBytes(casterStatus.byteRate || 0) }}/s</b></div>
          </div>
          <div class="empty" v-else>请确认后端 18088 已启动</div>
        </div>
        <div class="card">
          <div class="card-title">健康检查</div>
          <div class="kv" v-if="health">
            <div><span>status</span><b :class="health.status === 'UP' ? 'up' : 'down'">{{ health.status }}</b></div>
            <div><span>caster</span><b :class="health.caster === 'UP' ? 'up' : 'down'">{{ health.caster }}</b></div>
            <div><span>挂载点数</span><b>{{ health.mountpoints }}</b></div>
            <div><span>客户端数</span><b>{{ health.clients }}</b></div>
            <div><span>TCP 端口</span><b>{{ health.tcpPort }}</b></div>
            <div><span>HTTP 端口</span><b>{{ health.httpPort }}</b></div>
          </div>
          <div class="empty" v-else>请确认后端 18088 已启动</div>
          <div class="card-title" style="margin-top:14px">服务信息</div>
          <div class="kv" v-if="info">
            <div><span>service</span><b>{{ info.service }}</b></div>
            <div><span>version</span><b>{{ info.version }}</b></div>
            <div><span>uptime</span><b>{{ info.uptimeSeconds }}s</b></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-title">事件 / 告警</div>
        <div class="grid-2">
          <div>
            <div class="sub-title">事件列表（最近 {{ events.length }}）</div>
            <div class="event-list">
              <div class="event-item" v-for="(e, i) in events" :key="'e' + i">
                <span class="ev-time">{{ fmtTime(e.time) }}</span>
                <span class="ev-type">{{ e.type }}</span>
                <span class="ev-msg">{{ e.message }}</span>
              </div>
              <div class="empty" v-if="!events.length">暂无事件</div>
            </div>
          </div>
          <div>
            <div class="sub-title">告警列表（WARN/ERROR，{{ alerts.length }}）</div>
            <div class="event-list">
              <div class="event-item" v-for="(e, i) in alerts" :key="'a' + i" :class="'lv-' + levelTone(e.level)">
                <span class="ev-time">{{ fmtTime(e.time) }}</span>
                <span class="ev-type">{{ e.type }}</span>
                <span class="ev-msg">{{ e.message }}</span>
              </div>
              <div class="empty" v-if="!alerts.length">暂无告警</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-title">SSE 实时事件流（caster-event）</div>
        <div class="event-list sse">
          <div class="event-item" v-for="(e, i) in sseEvents" :key="'s' + i" :class="'lv-' + levelTone(e.level)">
            <span class="ev-time">{{ fmtTime(e.time) }}</span>
            <span class="ev-type">{{ e.type }}</span>
            <span class="ev-msg">{{ e.message }}</span>
          </div>
          <div class="empty" v-if="!sseEvents.length">等待实时事件推送…（后端未启动则无数据）</div>
        </div>
      </div>
    </section>

    <!-- Tab: 挂载点管理 -->
    <section v-show="activeTab === 'mountpoint'" class="tab-panel">
      <div class="toolbar">
        <button class="btn btn-primary" @click="openMpModal()">+ 新增挂载点</button>
        <span class="tip">共 {{ mpTotal }} 个挂载点</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>名称</th><th>格式</th><th>系统</th><th>启用</th><th>订阅者</th><th>数据源</th>
              <th>累计帧</th><th>帧速率</th><th>认证失败</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in mountpoints" :key="m.name">
              <td><b>{{ m.name }}</b></td>
              <td>{{ m.format || '—' }}</td>
              <td>{{ m.system || '—' }}</td>
              <td><span class="tag" :class="m.enabled ? 'on' : 'off'">{{ m.enabled ? '启用' : '禁用' }}</span></td>
              <td>{{ m.subscriberCount ?? 0 }}</td>
              <td>{{ m.hasSource ? '有' : '无' }}</td>
              <td>{{ fmtNum(m.sentFrames || 0) }}</td>
              <td>{{ m.frameRate ?? 0 }}</td>
              <td>{{ m.authFailures ?? 0 }}</td>
              <td class="ops">
                <button class="link" @click="toggleMp(m)">{{ m.enabled ? '禁用' : '启用' }}</button>
                <button class="link danger" @click="removeMp(m)">删除</button>
              </td>
            </tr>
            <tr v-if="!mountpoints.length"><td colspan="10" class="empty">暂无挂载点（请确认后端 18088 已启动）</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Tab: 客户端管理 -->
    <section v-show="activeTab === 'client'" class="tab-panel">
      <div class="toolbar">
        <input class="input" v-model="clientFilter" placeholder="按挂载点筛选（留空全部）" />
        <button class="btn" @click="loadClients">筛选</button>
        <span class="tip">{{ filteredClients.length }} 个会话</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>会话ID</th><th>远端地址</th><th>挂载点</th><th>角色</th><th>用户</th><th>NTRIP</th><th>时长(s)</th><th>收字节</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in filteredClients" :key="c.id">
              <td><b>{{ c.id }}</b></td>
              <td>{{ c.remoteAddress }}</td>
              <td>{{ c.mountpoint }}</td>
              <td><span class="tag" :class="c.role === 'SOURCE' ? 'src' : 'sub'">{{ c.role }}</span></td>
              <td>{{ c.username || '—' }}</td>
              <td>{{ c.ntripVersion }}</td>
              <td>{{ c.durationSeconds }}</td>
              <td>{{ fmtBytes(c.rxBytes || 0) }}</td>
              <td><span class="tag" :class="c.active ? 'on' : 'off'">{{ c.active ? '活跃' : '断开' }}</span></td>
              <td class="ops"><button class="link danger" @click="kickClient(c)">踢出</button></td>
            </tr>
            <tr v-if="!filteredClients.length"><td colspan="10" class="empty">暂无客户端会话</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Tab: 播发统计 -->
    <section v-show="activeTab === 'stats'" class="tab-panel">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>挂载点</th><th>启用</th><th>订阅者</th><th>数据源</th><th>累计帧</th><th>累计字节</th><th>帧速率</th><th>字节速率</th><th>源字节</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in mpStats" :key="m.name">
              <td><b>{{ m.name }}</b></td>
              <td><span class="tag" :class="m.enabled ? 'on' : 'off'">{{ m.enabled ? '启用' : '禁用' }}</span></td>
              <td>{{ m.subscriberCount ?? 0 }}</td>
              <td>{{ m.hasSource ? '有' : '无' }}</td>
              <td>{{ fmtNum(m.sentFrames || 0) }}</td>
              <td>{{ fmtBytes(m.sentBytes || 0) }}</td>
              <td>{{ m.frameRate ?? 0 }}</td>
              <td>{{ fmtBytes(m.byteRate || 0) }}/s</td>
              <td>{{ fmtBytes(m.sourceBytes || 0) }}</td>
            </tr>
            <tr v-if="!mpStats.length"><td colspan="9" class="empty">暂无统计（请确认后端 18088 已启动）</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Tab: 数据播发 -->
    <section v-show="activeTab === 'broadcast'" class="tab-panel">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">广播注入 / 模拟源</div>
          <div class="toolbar">
            <button class="btn btn-primary" @click="showInjectModal = true">注入播发数据</button>
            <button class="btn" @click="showSimModal = true">启动模拟源</button>
          </div>
          <div class="card-subtitle">模拟源状态</div>
          <div class="kv" v-if="Object.keys(simulatorStatus).length">
            <div v-for="(run, name) in simulatorStatus" :key="name">
              <span>{{ name }}</span>
              <b :class="run ? 'up' : 'down'">{{ run ? '运行中' : '已停止' }}</b>
              <button class="link danger" v-if="run" @click="stopSim(name)">停止</button>
            </div>
          </div>
          <div class="empty" v-else>暂无模拟源</div>
        </div>
        <div class="card">
          <div class="card-title">SOURCETABLE 源表</div>
          <pre class="code-block">{{ sourcetable || '（请确认后端 18088 已启动）' }}</pre>
        </div>
      </div>
    </section>

    <!-- AI 洞察 -->
    <div class="ai-panel">
      <div class="ai-head">🤖 AI 播发洞察</div>
      <ul class="ai-list">
        <li v-for="(t, i) in aiInsights" :key="i">{{ t }}</li>
      </ul>
    </div>

    <!-- 模态框：新增挂载点 -->
    <div class="modal-mask" v-if="showMpModal" @click.self="showMpModal = false">
      <div class="modal">
        <div class="modal-title">新增挂载点</div>
        <div class="form-row"><label>名称</label><input class="input" v-model="mpForm.name" placeholder="RTCM3_GPS" /></div>
        <div class="form-row"><label>格式</label><input class="input" v-model="mpForm.format" /></div>
        <div class="form-row"><label>卫星系统</label><input class="input" v-model="mpForm.system" /></div>
        <div class="form-row"><label>数据源描述</label><input class="input" v-model="mpForm.sourceDescription" /></div>
        <div class="form-row"><label>启用认证</label><input type="checkbox" v-model="mpForm.authRequired" /></div>
        <div class="form-row" v-if="mpForm.authRequired"><label>用户名</label><input class="input" v-model="mpForm.username" /></div>
        <div class="form-row" v-if="mpForm.authRequired"><label>密码</label><input class="input" type="password" v-model="mpForm.password" /></div>
        <div class="form-row"><label>立即启用</label><input type="checkbox" v-model="mpForm.enabled" /></div>
        <div class="modal-actions">
          <button class="btn" @click="showMpModal = false">取消</button>
          <button class="btn btn-primary" @click="saveMp">创建</button>
        </div>
      </div>
    </div>

    <!-- 模态框：注入播发 -->
    <div class="modal-mask" v-if="showInjectModal" @click.self="showInjectModal = false">
      <div class="modal">
        <div class="modal-title">注入播发数据</div>
        <div class="form-row"><label>挂载点</label><input class="input" v-model="injectForm.mountpoint" placeholder="RTCM3" /></div>
        <div class="form-row"><label>编码</label>
          <select class="input" v-model="injectForm.encoding"><option value="hex">hex</option><option value="base64">base64</option></select>
        </div>
        <div class="form-row"><label>RTCM 帧</label><textarea class="input" v-model="injectForm.data" rows="3" placeholder="D3001B60..."></textarea></div>
        <div class="form-row"><label>次数</label><input class="input" type="number" v-model="injectForm.times" /></div>
        <div class="modal-actions">
          <button class="btn" @click="showInjectModal = false">取消</button>
          <button class="btn btn-primary" @click="submitInject">注入</button>
        </div>
      </div>
    </div>

    <!-- 模态框：模拟源 -->
    <div class="modal-mask" v-if="showSimModal" @click.self="showSimModal = false">
      <div class="modal">
        <div class="modal-title">启动模拟数据源</div>
        <div class="form-row"><label>挂载点</label><input class="input" v-model="simForm.mountpoint" placeholder="RTCM3" /></div>
        <div class="form-row"><label>间隔(ms)</label><input class="input" type="number" v-model="simForm.intervalMs" /></div>
        <div class="form-row"><label>帧类型</label><input class="input" v-model="simForm.frameTypes" placeholder="1005,1077" /></div>
        <div class="modal-actions">
          <button class="btn" @click="showSimModal = false">取消</button>
          <button class="btn btn-primary" @click="startSim">启动</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div class="toast" :class="toast.type" v-if="toast.show">{{ toast.msg }}</div>
  </div>
</template>

<style scoped>
.module-view { padding: 20px 24px 40px; max-width: 1320px; margin: 0 auto; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.page-title { font-size: 22px; font-weight: 600; color: #1a1a2e; margin: 0; }
.page-sub { font-size: 13px; color: #888; margin: 4px 0 0; }
.head-actions { display: flex; align-items: center; gap: 12px; }
.updated { font-size: 12px; color: #999; }
.btn { padding: 7px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; color: #333; transition: all .2s; }
.btn:hover { border-color: #1890ff; color: #1890ff; }
.btn-primary { background: #1890ff; color: #fff; border-color: #1890ff; }
.btn-primary:hover { background: #40a9ff; color: #fff; }
.btn:disabled { opacity: .5; cursor: not-allowed; }

.kpi-row { display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px; margin-bottom: 18px; }
.kpi-card { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 14px 16px; }
.kpi-label { font-size: 12px; color: #8c8c8c; margin-bottom: 8px; }
.kpi-value { font-size: 20px; font-weight: 700; color: #1a1a2e; }
.tone-up { color: #52c41a; } .tone-down { color: #ff4d4f; } .tone-normal { color: #1a1a2e; }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid #eaeaea; margin-bottom: 16px; }
.tab { padding: 10px 18px; border: none; background: none; cursor: pointer; font-size: 14px; color: #595959; border-bottom: 2px solid transparent; }
.tab.active { color: #1890ff; border-bottom-color: #1890ff; font-weight: 500; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.card { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.card-title { font-size: 15px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; }
.card-subtitle { font-size: 13px; font-weight: 600; color: #595959; margin: 8px 0; }
.sub-title { font-size: 13px; color: #595959; margin-bottom: 8px; }
.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
.kv > div { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #f0f0f0; }
.kv span { color: #8c8c8c; }
.kv b { color: #1a1a2e; font-weight: 600; }
.kv b.up { color: #52c41a; } .kv b.down { color: #ff4d4f; }
.empty { color: #bbb; font-size: 13px; padding: 16px 0; text-align: center; }

.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.tip { font-size: 12px; color: #999; }
.input { padding: 7px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; min-width: 220px; }
.input:focus { outline: none; border-color: #1890ff; }

.table-wrap { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { background: #fafafa; text-align: left; padding: 10px 14px; color: #595959; font-weight: 600; border-bottom: 1px solid #f0f0f0; white-space: nowrap; }
.data-table td { padding: 10px 14px; border-bottom: 1px solid #f5f5f5; color: #333; white-space: nowrap; }
.data-table tbody tr:hover { background: #fafcff; }
.ops { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1890ff; cursor: pointer; font-size: 13px; padding: 0; }
.link:hover { text-decoration: underline; }
.link.danger { color: #ff4d4f; }
.tag { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 12px; background: #f0f0f0; color: #888; }
.tag.on { background: #e6f7ec; color: #52c41a; }
.tag.off { background: #fff1f0; color: #ff4d4f; }
.tag.sub { background: #e6f4ff; color: #1890ff; }
.tag.src { background: #f9f0ff; color: #722ed1; }

.event-list { max-height: 260px; overflow-y: auto; font-size: 13px; }
.event-list.sse { max-height: 200px; }
.event-item { display: flex; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #f5f5f5; }
.ev-time { color: #bbb; font-size: 12px; min-width: 130px; }
.ev-type { color: #1890ff; font-weight: 600; min-width: 140px; }
.ev-msg { color: #595959; flex: 1; }
.event-item.lv-error .ev-type { color: #ff4d4f; }
.event-item.lv-warn .ev-type { color: #fa8c16; }

.code-block { background: #0f172a; color: #a5d6ff; font-size: 12px; padding: 12px; border-radius: 8px; max-height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 0; }

.ai-panel { background: linear-gradient(90deg, rgba(24,144,255,0.05), rgba(114,46,209,0.05)); border: 1px solid #e6f0ff; border-radius: 10px; padding: 16px 18px; margin-top: 18px; }
.ai-head { font-size: 14px; font-weight: 600; color: #1890ff; margin-bottom: 10px; }
.ai-list { margin: 0; padding-left: 18px; }
.ai-list li { font-size: 13px; color: #333; line-height: 1.9; }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 22px 24px; width: 420px; max-height: 86vh; overflow-y: auto; }
.modal-title { font-size: 16px; font-weight: 600; color: #1a1a2e; margin-bottom: 16px; }
.form-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.form-row label { width: 84px; font-size: 13px; color: #595959; flex-shrink: 0; }
.form-row .input { flex: 1; min-width: 0; }
.form-row textarea.input { min-height: 64px; resize: vertical; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

.toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); padding: 10px 22px; border-radius: 8px; font-size: 14px; color: #fff; z-index: 200; }
.toast.success { background: #52c41a; } .toast.error { background: #ff4d4f; } .toast.info { background: #1890ff; }
</style>
