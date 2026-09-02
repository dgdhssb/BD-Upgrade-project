<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { mountpointApi } from '@/api/modules/mountpoint'

import ConnectionStatus from '@/components/ConnectionStatus.vue'

const toast = ref('')
let toastTimer: any = null
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 4000)
}

// ============ KPI ============
const kpi = ref({
  health: '-',
  version: '-',
  total: '-',
  enabled: '-',
  disabled: '-',
  alerts: '-',
  events: '-',
  formats: '-',
})

// ============ Tab ============
const tabs = [
  { key: 'overview', label: '监控运维' },
  { key: 'mountpoints', label: '挂载点生命周期' },
  { key: 'batch', label: '批量管理' },
  { key: 'auth', label: '权限管理' },
  { key: 'sourcetable', label: '数据源表' },
]
const activeTab = ref('overview')

// ============ 数据 ============
const health = ref<any>(null)
const versionInfo = ref<any>(null)
const statusInfo = ref<any>(null)
const events = ref<any[]>([])
const alerts = ref<any[]>([])
const mountpoints = ref<any[]>([])
const mpUsers = ref<any[]>([])
const selectedMp = ref('')
const stFormats = ref<string[]>([])
const stMappings = ref<any>(null)
const stBody = ref('')
const stLines = ref('')

// ============ 模态框 / 表单 ============
const showMpModal = ref(false)
const mpModalMode = ref<'create' | 'edit'>('create')
const mpForm = ref({
  name: '', format: 'RTCM3', system: 'GPS+BDS', sourceDescription: '', authRequired: true,
  username: '', password: '', enabled: true, maxClients: 10, country: 'CN',
  sampleRate: 1, carrier: 0, navSystem: 0,
})

const showUserModal = ref(false)
const userModalMode = ref<'add' | 'edit'>('add')
const userForm = ref({ username: '', password: '', role: 'USER' })
const editingUser = ref('')

const verifyForm = ref({ username: '', password: '' })
const verifyResult = ref<any>(null)

const batchNames = ref('BMP1\nBMP2')
const batchCreateJson = ref('[\n  { "name": "BMP1", "format": "RTCM3" },\n  { "name": "BMP2", "format": "RTCM3" }\n]')
const batchResult = ref<any>(null)

// ============ 加载 ============
async function loadSummary() {
  try {
    const [h, v, all, al, ev, fm] = await Promise.all([
      mountpointApi.health().catch(() => null),
      mountpointApi.version().catch(() => null),
      mountpointApi.listAllMountpoints().catch(() => []),
      mountpointApi.listAlerts().catch(() => []),
      mountpointApi.listEvents(20).catch(() => []),
      mountpointApi.sourcetableFormats().catch(() => []),
    ])
    health.value = h
    versionInfo.value = v
    mountpoints.value = (all as any[]) || []
    alerts.value = (al as any[]) || []
    events.value = (ev as any[]) || []
    stFormats.value = (fm as string[]) || []
    const total = mountpoints.value.length
    const enabled = mountpoints.value.filter((m) => m.enabled).length
    kpi.value.health = h ? '正常' : '异常'
    kpi.value.version = v && (v as any).version ? String((v as any).version) : (v ? '有' : '-')
    kpi.value.total = String(total)
    kpi.value.enabled = String(enabled)
    kpi.value.disabled = String(total - enabled)
    kpi.value.alerts = String(alerts.value.length)
    kpi.value.events = String(events.value.length)
    kpi.value.formats = String(stFormats.value.length)
    if (!selectedMp.value && mountpoints.value.length) selectedMp.value = mountpoints.value[0].name
  } catch (e: any) {
    showToast('概览加载失败：' + e.message)
  }
}

async function loadMountpoints() {
  try {
    mountpoints.value = (await mountpointApi.listAllMountpoints()) as any[]
    if (!selectedMp.value && mountpoints.value.length) selectedMp.value = mountpoints.value[0].name
  } catch (e: any) {
    showToast('挂载点加载失败：' + e.message)
  }
}

async function loadUsers() {
  if (!selectedMp.value) return
  try {
    mpUsers.value = (await mountpointApi.listUsers(selectedMp.value)) as any[]
  } catch (e: any) {
    showToast('用户加载失败：' + e.message)
  }
}

async function loadSourcetable() {
  try {
    stFormats.value = (await mountpointApi.sourcetableFormats()) as string[]
    stMappings.value = await mountpointApi.sourcetableMappings().catch(() => null)
  } catch (e: any) {
    showToast('数据源表加载失败：' + e.message)
  }
}

async function loadActiveTab() {
  switch (activeTab.value) {
    case 'mountpoints':
      await loadMountpoints()
      break
    case 'auth':
      await loadUsers()
      break
    case 'sourcetable':
      await loadSourcetable()
      break
  }
}

// ============ 挂载点动作 ============
function openCreate() {
  mpModalMode.value = 'create'
  mpForm.value = {
    name: '', format: 'RTCM3', system: 'GPS+BDS', sourceDescription: '', authRequired: true,
    username: '', password: '', enabled: true, maxClients: 10, country: 'CN',
    sampleRate: 1, carrier: 0, navSystem: 0,
  }
  showMpModal.value = true
}
function openEdit(mp: any) {
  mpModalMode.value = 'edit'
  mpForm.value = {
    name: mp.name || '', format: mp.format || 'RTCM3', system: mp.system || 'GPS+BDS',
    sourceDescription: mp.sourceDescription || '', authRequired: !!mp.authRequired,
    username: mp.username || '', password: '', enabled: mp.enabled !== false,
    maxClients: mp.maxClients ?? 10, country: mp.country || 'CN',
    sampleRate: mp.sampleRate ?? 1, carrier: mp.carrier ?? 0, navSystem: mp.navSystem ?? 0,
  }
  showMpModal.value = true
}
async function saveMp() {
  try {
    if (mpModalMode.value === 'create') {
      await mountpointApi.createMountpoint({ ...mpForm.value })
      showToast('挂载点已创建')
    } else {
      await mountpointApi.updateMountpointPut(mpForm.value.name, { ...mpForm.value })
      showToast('挂载点已更新')
    }
    showMpModal.value = false
    await loadMountpoints()
  } catch (e: any) {
    showToast('保存失败：' + e.message)
  }
}
async function toggleMp(name: string) {
  try { await mountpointApi.toggleMountpoint(name); showToast('已切换'); await loadMountpoints() }
  catch (e: any) { showToast('失败：' + e.message) }
}
async function enableMp(name: string) {
  try { await mountpointApi.enableMountpoint(name); showToast('已启用'); await loadMountpoints() }
  catch (e: any) { showToast('失败：' + e.message) }
}
async function disableMp(name: string) {
  try { await mountpointApi.disableMountpoint(name); showToast('已停用'); await loadMountpoints() }
  catch (e: any) { showToast('失败：' + e.message) }
}
async function removeMp(name: string) {
  try { await mountpointApi.deleteMountpoint(name); showToast('已删除'); await loadMountpoints() }
  catch (e: any) { showToast('删除失败：' + e.message) }
}

// ============ 权限动作 ============
function openAddUser() {
  userModalMode.value = 'add'
  userForm.value = { username: '', password: '', role: 'USER' }
  showUserModal.value = true
}
function openEditUser(u: any) {
  userModalMode.value = 'edit'
  editingUser.value = u.username
  userForm.value = { username: u.username, password: '', role: u.role || 'USER' }
  showUserModal.value = true
}
async function saveUser() {
  if (!selectedMp.value) return showToast('请先选择挂载点')
  try {
    if (userModalMode.value === 'add') {
      await mountpointApi.addUser(selectedMp.value, { ...userForm.value })
      showToast('用户已添加')
    } else {
      await mountpointApi.updateUser(selectedMp.value, editingUser.value, { ...userForm.value })
      showToast('用户已更新')
    }
    showUserModal.value = false
    await loadUsers()
  } catch (e: any) { showToast('保存失败：' + e.message) }
}
async function enableUser(u: string) {
  if (!selectedMp.value) return
  try { await mountpointApi.enableUser(selectedMp.value, u); showToast('已启用'); await loadUsers() }
  catch (e: any) { showToast('失败：' + e.message) }
}
async function disableUser(u: string) {
  if (!selectedMp.value) return
  try { await mountpointApi.disableUser(selectedMp.value, u); showToast('已停用'); await loadUsers() }
  catch (e: any) { showToast('失败：' + e.message) }
}
async function removeUser(u: string) {
  if (!selectedMp.value) return
  try { await mountpointApi.deleteUser(selectedMp.value, u); showToast('已删除'); await loadUsers() }
  catch (e: any) { showToast('删除失败：' + e.message) }
}
async function runVerify() {
  if (!selectedMp.value) return showToast('请先选择挂载点')
  try {
    verifyResult.value = await mountpointApi.verifyUser(selectedMp.value, verifyForm.value.username, verifyForm.value.password)
    showToast('校验完成')
  } catch (e: any) { showToast('校验失败：' + e.message) }
}

// ============ 批量动作 ============
function parseNames(): string[] {
  return batchNames.value.split('\n').map((s) => s.trim()).filter(Boolean)
}
async function runBatch(action: 'query' | 'enable' | 'disable' | 'delete') {
  const names = parseNames()
  if (!names.length) return showToast('请填写挂载点名称')
  try {
    if (action === 'query') batchResult.value = await mountpointApi.batchQuery(names)
    if (action === 'enable') { await mountpointApi.batchEnable(names); batchResult.value = '已批量启用'; await loadMountpoints() }
    if (action === 'disable') { await mountpointApi.batchDisable(names); batchResult.value = '已批量停用'; await loadMountpoints() }
    if (action === 'delete') { await mountpointApi.batchDelete(names); batchResult.value = '已批量删除'; await loadMountpoints() }
    showToast('批量' + action + '完成')
  } catch (e: any) { showToast('批量失败：' + e.message) }
}
async function runBatchCreate() {
  try {
    const list = JSON.parse(batchCreateJson.value)
    await mountpointApi.batchCreate(list)
    batchResult.value = '批量创建成功'
    showToast('批量创建完成')
    await loadMountpoints()
  } catch (e: any) { showToast('批量创建失败：' + e.message) }
}

// ============ 数据源表动作 ============
async function loadStBody() {
  try { stBody.value = await mountpointApi.sourcetableBody() } catch (e: any) { showToast('加载失败：' + e.message) }
}
async function loadStLines() {
  try { stLines.value = await mountpointApi.sourcetableLines() } catch (e: any) { showToast('加载失败：' + e.message) }
}

let timer: any = null
function startPolling() {
  timer = setInterval(() => { loadSummary() }, 30000)
}

onMounted(() => { loadSummary(); loadActiveTab(); startPolling() })
onBeforeUnmount(() => { if (timer) clearInterval(timer); if (toastTimer) clearTimeout(toastTimer) })

function fmtTime(t: string) {
  if (!t) return '-'
  return t.replace('T', ' ').slice(0, 19)
}
const aiInsights = computed(() => {
  const arr: string[] = []
  if (kpi.value.health === '正常') arr.push('挂载点服务运行正常，可对外提供 NTRIP 数据源。')
  else arr.push('挂载点服务健康检查未通过，请确认 18089 已启动。')
  if (kpi.value.alerts !== '-' && Number(kpi.value.alerts) > 0)
    arr.push(`存在 ${kpi.value.alerts} 条告警，建议结合挂载点生命周期与权限排查异常源。`)
  if (kpi.value.disabled !== '-' && Number(kpi.value.disabled) > 0)
    arr.push(`有 ${kpi.value.disabled} 个挂载点处于停用状态，可按需启用或清理。`)
  if (arr.length === 0) arr.push('各项指标正常。')
  return arr
})
</script>

<template>
  <div class="module-view">
    <ConnectionStatus service-name="挂载点服务" :port="18089" health-path="/api/v1/mountpoint/health" mode="real" />
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">📡 挂载点服务</h1>
        <span class="sr-tag">MS-09 · 18089</span>
      </div>
      <button class="btn-ghost" @click="() => { loadSummary(); loadActiveTab() }">🔄 刷新</button>
    </div>

    <div class="kpi-row">
      <div class="kpi-card" v-for="(item, idx) in [
        { label: '健康状态', value: kpi.health, icon: '💚', color: kpi.health === '正常' ? '#52c41a' : '#ff4d4f' },
        { label: '版本', value: kpi.version, icon: '🏷', color: '#1890ff' },
        { label: '挂载点总数', value: kpi.total, icon: '📡', color: '#1890ff' },
        { label: '已启用', value: kpi.enabled, icon: '✅', color: '#52c41a' },
        { label: '已停用', value: kpi.disabled, icon: '⏸', color: '#faad14' },
        { label: '告警数', value: kpi.alerts, icon: '🔔', color: '#ff4d4f' },
        { label: '运行事件', value: kpi.events, icon: '📜', color: '#722ed1' },
        { label: '源表格式', value: kpi.formats, icon: '🗂', color: '#13c2c2' },
      ]" :key="idx">
        <div class="kpi-icon" :style="{ color: item.color }">{{ item.icon }}</div>
        <div class="kpi-info">
          <div class="kpi-value" :style="{ color: item.color }">{{ item.value }}</div>
          <div class="kpi-label">{{ item.label }}</div>
        </div>
      </div>
    </div>

    <div class="insight-bar">
      <span class="insight-icon">💡</span>
      <ul class="insight-list"><li v-for="(t, i) in aiInsights" :key="i">{{ t }}</li></ul>
    </div>

    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" class="tab" :class="{ active: activeTab === t.key }" @click="activeTab = t.key; loadActiveTab()">{{ t.label }}</button>
    </div>

    <!-- 监控运维 -->
    <div class="tab-panel" v-if="activeTab === 'overview'">
      <div class="panel-title">🩺 监控运维</div>
      <div class="grid-3">
        <div class="metric-box"><div class="mv">{{ health ? 'UP' : 'DOWN' }}</div><div class="ml">健康检查</div></div>
        <div class="metric-box"><div class="mv">{{ versionInfo && versionInfo.version ? versionInfo.version : '-' }}</div><div class="ml">版本号</div></div>
        <div class="metric-box"><div class="mv">{{ statusInfo && statusInfo.uptime != null ? statusInfo.uptime : '-' }}</div><div class="ml">运行时长</div></div>
      </div>
      <div class="sub-title">运行事件（最近 20）</div>
      <div class="table-card">
        <div class="table-header"><div class="c2">类型</div><div class="c2">挂载点</div><div class="c3">描述</div><div class="c2">时间</div></div>
        <div v-if="!events.length" class="table-empty">暂无事件</div>
        <div v-for="(e, i) in events" :key="i" class="table-row">
          <div class="c2">{{ e.type || e.eventType || '-' }}</div>
          <div class="c2 mono">{{ e.mountpoint || '-' }}</div>
          <div class="c3">{{ e.message || e.description || '-' }}</div>
          <div class="c2 mono">{{ fmtTime(e.time || e.timestamp || '') }}</div>
        </div>
      </div>
      <div class="sub-title">告警</div>
      <div class="table-card">
        <div class="table-header"><div class="c2">级别</div><div class="c3">内容</div><div class="c2">时间</div></div>
        <div v-if="!alerts.length" class="table-empty">暂无告警</div>
        <div v-for="(a, i) in alerts" :key="i" class="table-row">
          <div class="c2"><span class="level-badge" :class="(a.level || 'warning').toLowerCase()">{{ a.level || 'WARNING' }}</span></div>
          <div class="c3">{{ a.message || a.description || '-' }}</div>
          <div class="c2 mono">{{ fmtTime(a.time || '') }}</div>
        </div>
      </div>
    </div>

    <!-- 挂载点生命周期 -->
    <div class="tab-panel" v-if="activeTab === 'mountpoints'">
      <div class="panel-header-row">
        <div class="panel-title">📡 挂载点生命周期</div>
        <button class="btn-primary-sm" @click="openCreate">+ 新建挂载点</button>
      </div>
      <div class="table-card">
        <div class="table-header"><div class="c2">名称</div><div class="c1">格式</div><div class="c1">系统</div><div class="c1">鉴权</div><div class="c1">最大连接</div><div class="c1">状态</div><div class="c2">操作</div></div>
        <div v-if="!mountpoints.length" class="table-empty">暂无挂载点</div>
        <div v-for="m in mountpoints" :key="m.name" class="table-row">
          <div class="c2 mono">{{ m.name }}</div>
          <div class="c1">{{ m.format }}</div>
          <div class="c1">{{ m.system }}</div>
          <div class="c1">{{ m.authRequired ? '是' : '否' }}</div>
          <div class="c1">{{ m.maxClients }}</div>
          <div class="c1"><span class="status-sm" :class="m.enabled ? 'on' : 'off'">{{ m.enabled ? '启用' : '停用' }}</span></div>
          <div class="c2 btn-col">
            <button class="btn-link" @click="openEdit(m)">编辑</button>
            <button class="btn-link" @click="toggleMp(m.name)">切换</button>
            <button class="btn-link" v-if="!m.enabled" @click="enableMp(m.name)">启用</button>
            <button class="btn-link" v-else @click="disableMp(m.name)">停用</button>
            <button class="btn-link danger" @click="removeMp(m.name)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量管理 -->
    <div class="tab-panel" v-if="activeTab === 'batch'">
      <div class="panel-title">📦 批量管理</div>
      <div class="filter-bar" style="align-items:flex-start">
        <div class="filter-group" style="flex-direction:column;align-items:flex-start">
          <label>挂载点名称（每行一个）</label>
          <textarea v-model="batchNames" class="form-input" rows="4" style="width:260px;font-family:monospace"></textarea>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" @click="runBatch('query')">批量查询</button>
        <button class="btn-ghost" @click="runBatch('enable')">批量启用</button>
        <button class="btn-ghost" @click="runBatch('disable')">批量停用</button>
        <button class="btn-ghost" @click="runBatch('delete')">批量删除</button>
      </div>
      <div class="sub-title">批量创建（JSON 数组）</div>
      <textarea v-model="batchCreateJson" class="form-input" rows="6" style="width:460px;font-family:monospace"></textarea>
      <div class="btn-row"><button class="btn-primary-sm" @click="runBatchCreate">🚀 批量创建</button></div>
      <div class="result-box" v-if="batchResult"><pre>{{ JSON.stringify(batchResult, null, 2) }}</pre></div>
    </div>

    <!-- 权限管理 -->
    <div class="tab-panel" v-if="activeTab === 'auth'">
      <div class="panel-header-row">
        <div class="panel-title">🔐 权限管理（挂载点用户）</div>
        <button class="btn-primary-sm" @click="openAddUser">+ 新增用户</button>
      </div>
      <div class="filter-bar">
        <div class="filter-group"><label>选择挂载点</label>
          <select v-model="selectedMp" class="form-input" @change="loadUsers">
            <option v-for="m in mountpoints" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
        </div>
      </div>
      <div class="table-card">
        <div class="table-header"><div class="c2">用户名</div><div class="c1">角色</div><div class="c1">状态</div><div class="c2">操作</div></div>
        <div v-if="!mpUsers.length" class="table-empty">该挂载点暂无用户</div>
        <div v-for="u in mpUsers" :key="u.username" class="table-row">
          <div class="c2 mono">{{ u.username }}</div>
          <div class="c1">{{ u.role }}</div>
          <div class="c1"><span class="status-sm" :class="u.enabled !== false ? 'on' : 'off'">{{ u.enabled !== false ? '启用' : '停用' }}</span></div>
          <div class="c2 btn-col">
            <button class="btn-link" @click="openEditUser(u)">编辑</button>
            <button class="btn-link" v-if="u.enabled === false" @click="enableUser(u.username)">启用</button>
            <button class="btn-link" v-else @click="disableUser(u.username)">停用</button>
            <button class="btn-link danger" @click="removeUser(u.username)">删除</button>
          </div>
        </div>
      </div>
      <div class="sub-title">账号校验</div>
      <div class="filter-bar">
        <div class="filter-group"><label>用户名</label><input v-model="verifyForm.username" class="form-input"></div>
        <div class="filter-group"><label>密码</label><input v-model="verifyForm.password" type="password" class="form-input"></div>
        <button class="btn-ghost" @click="runVerify">🔍 校验</button>
      </div>
      <div class="result-box" v-if="verifyResult"><pre>{{ JSON.stringify(verifyResult, null, 2) }}</pre></div>
    </div>

    <!-- 数据源表 -->
    <div class="tab-panel" v-if="activeTab === 'sourcetable'">
      <div class="panel-title">🗂 数据源表（NTRIP sourcetable）</div>
      <div class="sub-title">支持格式</div>
      <div class="chip-row">
        <span class="chip" v-for="(f, i) in stFormats" :key="i">{{ f }}</span>
        <span v-if="!stFormats.length" class="table-empty">暂无</span>
      </div>
      <div class="sub-title">映射（mappings）</div>
      <div class="result-box" v-if="stMappings"><pre>{{ JSON.stringify(stMappings, null, 2) }}</pre></div>
      <div v-else class="table-empty">暂无映射</div>
      <div class="btn-row">
        <button class="btn-ghost" @click="loadStBody">查看 body</button>
        <button class="btn-ghost" @click="loadStLines">查看 lines</button>
      </div>
      <div class="result-box" v-if="stBody"><b>body</b><pre>{{ stBody }}</pre></div>
      <div class="result-box" v-if="stLines"><b>lines</b><pre>{{ stLines }}</pre></div>
    </div>

    <!-- 模态框：挂载点 -->
    <div v-if="showMpModal" class="modal-overlay" @click="showMpModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header"><h3>{{ mpModalMode === 'create' ? '📡 新建挂载点' : '✏️ 编辑挂载点' }}</h3><button class="close-btn" @click="showMpModal = false">×</button></div>
        <div class="modal-body">
          <div class="form-group"><label>名称 *</label><input v-model="mpForm.name" class="form-input" :disabled="mpModalMode === 'edit'"></div>
          <div class="form-group"><label>格式 *</label>
            <select v-model="mpForm.format" class="form-input"><option>RTCM3</option><option>RTCM2</option><option>RINEX</option></select>
          </div>
          <div class="form-group"><label>系统</label><input v-model="mpForm.system" class="form-input" placeholder="如 GPS+BDS"></div>
          <div class="form-group"><label>描述</label><input v-model="mpForm.sourceDescription" class="form-input"></div>
          <div class="form-group"><label>国家</label><input v-model="mpForm.country" class="form-input"></div>
          <div class="form-group"><label>最大连接</label><input v-model="mpForm.maxClients" type="number" class="form-input"></div>
          <div class="form-group"><label>采样率</label><input v-model="mpForm.sampleRate" type="number" class="form-input"></div>
          <div class="form-group"><label>载波</label><input v-model="mpForm.carrier" type="number" class="form-input"></div>
          <div class="form-group"><label>导航系统</label><input v-model="mpForm.navSystem" type="number" class="form-input"></div>
          <div class="form-group"><label><input type="checkbox" v-model="mpForm.authRequired"> 需要鉴权</label></div>
          <div class="form-group"><label><input type="checkbox" v-model="mpForm.enabled"> 启用</label></div>
          <template v-if="mpForm.authRequired">
            <div class="form-group"><label>用户名</label><input v-model="mpForm.username" class="form-input"></div>
            <div class="form-group"><label>密码</label><input v-model="mpForm.password" type="password" class="form-input"></div>
          </template>
        </div>
        <div class="modal-footer"><button class="btn-ghost" @click="showMpModal = false">取消</button><button class="btn-primary" @click="saveMp">💾 保存</button></div>
      </div>
    </div>

    <!-- 模态框：用户 -->
    <div v-if="showUserModal" class="modal-overlay" @click="showUserModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header"><h3>{{ userModalMode === 'add' ? '🔐 新增用户' : '✏️ 编辑用户' }}</h3><button class="close-btn" @click="showUserModal = false">×</button></div>
        <div class="modal-body">
          <div class="form-group"><label>用户名 *</label><input v-model="userForm.username" class="form-input" :disabled="userModalMode === 'edit'"></div>
          <div class="form-group"><label>密码</label><input v-model="userForm.password" type="password" class="form-input" :placeholder="userModalMode === 'edit' ? '留空不修改' : ''"></div>
          <div class="form-group"><label>角色</label>
            <select v-model="userForm.role" class="form-input"><option>USER</option><option>ADMIN</option></select>
          </div>
        </div>
        <div class="modal-footer"><button class="btn-ghost" @click="showUserModal = false">取消</button><button class="btn-primary" @click="saveUser">💾 保存</button></div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.module-view { padding: 24px; min-height: 100vh; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.page-title { font-size: 22px; font-weight: 600; color: #1a1a2e; margin: 0; }
.sr-tag { font-size: 12px; color: #888; background: #f5f5f5; padding: 4px 10px; border-radius: 4px; }

.kpi-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.kpi-card { background: #fff; border-radius: 12px; padding: 16px 20px; display: flex; align-items: center; gap: 12px; min-width: 120px; flex: 1; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
.kpi-icon { font-size: 24px; }
.kpi-value { font-size: 24px; font-weight: 700; }
.kpi-label { font-size: 13px; color: #888; margin-top: 2px; }

.insight-bar { display: flex; gap: 10px; align-items: flex-start; background: linear-gradient(90deg, rgba(24,144,255,0.06), rgba(114,46,209,0.04)); border: 1px solid #e6f0ff; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
.insight-icon { font-size: 18px; }
.insight-list { margin: 0; padding-left: 16px; font-size: 13px; color: #595959; line-height: 1.7; }

.tabs { display: flex; gap: 6px; background: #f0f0f0; padding: 5px; border-radius: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.tab { padding: 8px 16px; font-size: 14px; color: #595959; cursor: pointer; border-radius: 7px; border: none; background: transparent; }
.tab.active { background: #fff; color: #1890ff; font-weight: 500; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }

.panel-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.panel-title { font-size: 15px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; }
.sub-title { font-size: 14px; font-weight: 600; color: #595959; margin: 16px 0 8px; }

.btn-primary-sm { padding: 6px 14px; background: #1890ff; color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-ghost { padding: 8px 16px; background: #fff; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; color: #595959; cursor: pointer; }

.table-card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); overflow: hidden; margin-bottom: 8px; }
.table-header, .table-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 2fr; gap: 8px; padding: 11px 14px; align-items: center; font-size: 13px; }
.table-header { background: #fafafa; font-weight: 600; color: #888; border-bottom: 1px solid #f0f0f0; }
.table-row { border-bottom: 1px solid #f5f5f5; transition: background 0.2s; }
.table-row:hover { background: #f6f7fa; }
.mono { font-family: monospace; font-size: 12px; }
.table-empty { padding: 24px; text-align: center; color: #999; font-size: 13px; }
.c1, .c2, .c3 { color: #595959; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c3 { grid-column: span 1; }
.btn-col { display: flex; gap: 4px; flex-wrap: wrap; }

.status-sm { font-size: 12px; padding: 2px 8px; border-radius: 4px; }
.status-sm.on { background: #f6ffed; color: #52c41a; }
.status-sm.off { background: #fff1f0; color: #ff4d4f; }
.level-badge { font-size: 12px; padding: 3px 9px; border-radius: 10px; font-weight: 500; display: inline-block; }
.level-badge.info { background: #e6f7ff; color: #1890ff; }
.level-badge.warning { background: #fff7e6; color: #faad14; }
.level-badge.critical { background: #fff1f0; color: #ff4d4f; }
.btn-link { font-size: 12px; color: #1890ff; background: none; border: none; cursor: pointer; padding: 0 4px; }
.btn-link:hover { text-decoration: underline; }
.btn-link.danger { color: #ff4d4f; }

.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
.metric-box { background: #fff; border-radius: 10px; padding: 16px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
.mv { font-size: 26px; font-weight: 700; color: #1a1a2e; }
.ml { font-size: 12px; color: #888; margin-top: 4px; }

.filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
.filter-group { display: flex; align-items: center; gap: 8px; }
.filter-group label { font-size: 13px; color: #595959; }
.form-input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; background: #fff; }
.btn-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.result-box { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 10px; padding: 14px; font-size: 12px; color: #595959; margin-bottom: 12px; max-height: 360px; overflow: auto; }
.result-box pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; }

.chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.chip { background: #e6f7ff; color: #1890ff; font-size: 12px; padding: 4px 12px; border-radius: 12px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: #fff; border-radius: 12px; width: 540px; max-width: 92vw; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid #f0f0f0; }
.modal-header h3 { margin: 0; font-size: 16px; color: #1a1a2e; }
.close-btn { background: none; border: none; font-size: 22px; color: #888; cursor: pointer; }
.modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; max-height: 60vh; overflow-y: auto; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 14px; color: #595959; font-weight: 500; }
.modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 14px 24px; border-top: 1px solid #f0f0f0; }
.btn-primary { padding: 9px 20px; background: #1890ff; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }

.toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a2e; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; z-index: 2000; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }

@media (max-width: 1200px) { .grid-3 { grid-template-columns: repeat(2, 1fr); } .table-header, .table-row { grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr 1fr 2fr; } }
@media (max-width: 768px) { .kpi-row { flex-direction: column; } }
</style>
