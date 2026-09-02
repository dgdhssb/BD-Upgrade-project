<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { ntripClientApi, type MountpointDTO, type MountpointRequestDTO } from '@/api/modules/ntripclient'

import ConnectionStatus from '@/components/ConnectionStatus.vue'

// ============ 通用状态 ============
const activeTab = ref('mountpoints')
const loading = ref(false)
const toast = reactive({ show: false, msg: '', type: 'info' as 'info' | 'success' | 'error' })
let toastTimer: number | undefined
function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  toast.msg = msg
  toast.type = type
  toast.show = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.show = false), 2600)
}

/**
 * 纯真实模式：任何接口失败都必须把**后端原始错误**暴露在页面上，绝不静默吞掉。
 * 后端未启动时这里会集中列出每个接口的真实报错——这正是联调需要看到的信息，
 * 用空态或演示数据掩盖等于白做。
 */
const reqErrors = reactive<Record<string, string>>({})
function setErr(key: string, e: unknown) {
  reqErrors[key] = e instanceof Error ? e.message : String(e)
}
function clearErrs() {
  Object.keys(reqErrors).forEach((k) => delete reqErrors[k])
}
const errorList = computed(() => Object.entries(reqErrors).map(([key, msg]) => ({ key, msg })))

const enc = encodeURIComponent

// ============ KPI ============
const kpi = reactive({
  total: 0,
  enabled: 0,
  connected: 0,
  connecting: 0,
  error: 0,
  rateKbps: 0,
  bytesReceived: 0,
  framesReceived: 0,
})

// ============ Tab 1：挂载点管理 ============
const mountpoints = ref<MountpointDTO[]>([])
const selected = ref<string[]>([])

// ============ Tab 2：连接控制 ============
const connections = ref<any[]>([])

// ============ Tab 3：状态监控 ============
const statusVO = ref<any>(null)

// ============ Tab 4：接收统计 ============
const statsVO = ref<any>(null)
const rateHistory = ref<any[]>([])
const historyMp = ref<string>('')           // 速率历史：当前选中的挂载点
const historySeconds = ref<number>(60)       // 采样窗口（接口文档：默认 60，最长 3600）
const historyLoading = ref(false)

// ============ Tab 5：解码统计 ============
const decodeStats = ref<any[]>([])

// ============ Tab 6：事件 / 告警 ============
const events = ref<any[]>([])
const alerts = ref<any[]>([])
/** 按挂载点下钻（空串 = 全部，走 /events 与 /alerts） */
const eventFilterMp = ref<string>('')
const alertFilterMp = ref<string>('')

// ============ Tab 7：数据源 ============
const datasources = ref<any[]>([])

// ============ Tab 8：监控运维 ============
const health = ref<any>(null)
const versionInfo = ref<any>(null)
const configSnapshot = ref<any>(null)
const sseCount = ref<number | null>(null)
const liveEvents = ref<any[]>([])
/** SSE 连接状态：idle 未连接 / open 已连接 / error 中断重连中 */
const sseState = ref<'idle' | 'open' | 'error'>('idle')
let es: EventSource | null = null

// ============ 模态框 ============
const showMpModal = ref(false)
const mpForm = reactive<MountpointRequestDTO>({
  name: '',
  enabled: true,
  format: 'RTCM3',
  satelliteSystems: 'GPS+BDS+GLONASS+Galileo',
  authRequired: false,
  username: '',
  password: '',
  sourceDescription: '',
  casterHost: null,
  casterPort: null,
  connectTimeoutMs: null,
  idleTimeoutSec: null,
  /** 三态：null=回退全局 / true=开启 / false=关闭（接口文档 §4.1.3） */
  crcCheck: null,
  decodeEnabled: null,
})
const mpModalMode = ref<'create' | 'edit'>('create')
const mpEditName = ref('')

function openCreateMp() {
  mpModalMode.value = 'create'
  mpEditName.value = ''
  Object.assign(mpForm, {
    name: '',
    enabled: true,
    format: 'RTCM3',
    satelliteSystems: 'GPS+BDS+GLONASS+Galileo',
    authRequired: false,
    username: '',
    password: '',
    sourceDescription: '',
    casterHost: null,
    casterPort: null,
    connectTimeoutMs: null,
    idleTimeoutSec: null,
    crcCheck: null,
    decodeEnabled: null,
  })
  showMpModal.value = true
}

/** 香港 SatRef 单基准站快速模板（以 HKSC_32 昂船洲为例） */
const MP_PRESETS: Record<string, Partial<MountpointRequestDTO>> = {
  hksc32: {
    name: 'HKSC_32',
    enabled: true,
    format: 'RTCM3',
    satelliteSystems: 'GPS+BDS+GLONASS+Galileo',
    sourceDescription: '香港地政总署 SatRef 单基准站（Stonecutters Island）',
    casterHost: 'ntrip.geodetic.gov.hk',
    casterPort: 2101,
    connectTimeoutMs: 5000,
    idleTimeoutSec: 60,
    crcCheck: true,
    decodeEnabled: true,
    authRequired: true,
  },
}
function applyPreset(key: string) {
  const preset = MP_PRESETS[key]
  if (!preset) return
  Object.assign(mpForm, preset)
  showToast(`已载入 ${preset.name || key} 模板，请补填 SatRef 用户名/密码`, 'info')
}

/**
 * 请求体规范化 —— 严格对齐接口文档 §4.1.3 `MountpointRequestDTO`
 *
 * 文档原文：
 *   casterHost      string  否  null  Caster 主机（回退全局）
 *   casterPort      int     否  null  Caster 端口（<=0 回退全局）
 *   connectTimeoutMs int    否  null  TCP 建连超时（<=0 回退全局）
 *   idleTimeoutSec  int     否  null  数据空闲超时（<=0 回退全局）
 *   crcCheck        boolean 否  null  CRC-24Q 校验开关（null 回退全局）
 *   decodeEnabled   boolean 否  null  解码统计开关（null 回退全局）
 *
 * 必须处理的两类问题：
 *  1. 表单留空时 v-model 给的是空串 ''，直接提交会把 int 字段变成 ""，
 *     后端反序列化失败（类型不匹配）；且 '' ≠ null，不会触发"回退全局"。
 *  2. v-model.number 在空输入时仍返回 ''（parseFloat('')=NaN 时 Vue 保留原值），
 *     需显式收敛为 null。
 */
function buildMpPayload(): MountpointRequestDTO {
  /** 数值字段：空/非数字 → null（文档约定 <=0 回退全局，null 同样回退） */
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  /** 字符串覆盖字段：留空 → null（回退全局），不能提交空串 */
  const nullableStr = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    return s === '' ? null : s
  }
  /** 默认 "" 的普通字符串字段（文档：username / sourceDescription 默认 ""） */
  const str = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v).trim()
    return s
  }

  const dto: MountpointRequestDTO = {
    name: mpForm.name,
    enabled: mpForm.enabled,
    format: str(mpForm.format) || 'RTCM3',
    satelliteSystems: str(mpForm.satelliteSystems) || 'GPS+BDS+GLONASS+Galileo',
    authRequired: mpForm.authRequired,
    username: str(mpForm.username),
    sourceDescription: str(mpForm.sourceDescription),
    casterHost: nullableStr(mpForm.casterHost),
    casterPort: num(mpForm.casterPort),
    connectTimeoutMs: num(mpForm.connectTimeoutMs),
    idleTimeoutSec: num(mpForm.idleTimeoutSec),
    crcCheck: mpForm.crcCheck ?? null,
    decodeEnabled: mpForm.decodeEnabled ?? null,
  }

  // 密码：新增时必传（可为空串）；编辑时留空表示"不修改"，直接不下发该字段，
  // 否则会把后端已有密码清成空串。
  const pwd = mpForm.password
  if (mpModalMode.value === 'create' || (pwd !== null && pwd !== undefined && pwd !== '')) {
    dto.password = pwd
  }
  return dto
}

async function openEditMp(mp: MountpointDTO) {
  mpModalMode.value = 'edit'
  mpEditName.value = mp.name || ''
  try {
    const full = await ntripClientApi.getMountpoint(mp.name || '')
    Object.assign(mpForm, {
      name: full.name,
      enabled: full.enabled ?? true,
      format: full.format || 'RTCM3',
      satelliteSystems: full.satelliteSystems || 'GPS+BDS+GLONASS+Galileo',
      authRequired: full.authRequired ?? false,
      username: full.username || '',
      password: '',
      sourceDescription: full.sourceDescription || '',
      casterHost: full.ownCasterHost ?? null,
      casterPort: full.ownCasterPort ?? null,
      connectTimeoutMs: full.connectTimeoutMs ?? null,
      idleTimeoutSec: full.idleTimeoutSec ?? null,
      crcCheck: full.crcCheck ?? null,
      decodeEnabled: full.decodeEnabled ?? null,
    })
    showMpModal.value = true
  } catch (e: any) {
    showToast('读取挂载点失败：' + e.message, 'error')
  }
}

async function submitMp() {
  try {
    const payload = buildMpPayload()
    if (mpModalMode.value === 'create') {
      if (!payload.name) return showToast('挂载点名称不能为空', 'error')
      await ntripClientApi.createMountpoint(payload)
      showToast('挂载点已创建', 'success')
    } else {
      // 编辑：接口文档 §3 第 4 项明确是 POST /mountpoints/{mountpoint}，不是 PUT
      await ntripClientApi.updateMountpoint(mpEditName.value, payload)
      showToast('挂载点已更新', 'success')
    }
    showMpModal.value = false
    await loadAll()
  } catch (e: any) {
    showToast('保存失败：' + e.message, 'error')
  }
}

// ============ 操作 ============
/**
 * 连接/断开/重连/启停 全部是**异步指令**：
 * 接口返回 code=0 仅表示「指令已受理」，真实连接状态要 1~2s 后才稳定
 * （或由 SSE 的 connection-event 推送确认）。
 * 所以这里先立刻刷一次（反映受理），再延迟 1.5s 刷第二次（拿到稳定状态），
 * 否则会停留在「已发起连接但状态还是 DISCONNECTED」的假象上。
 */
function refreshAfterCommand(delay = 1500) {
  window.setTimeout(() => void loadAll(), delay)
}

async function toggleMp(mp: MountpointDTO) {
  try {
    if (mp.enabled) await ntripClientApi.disableMountpoint(mp.name || '')
    else await ntripClientApi.enableMountpoint(mp.name || '')
    showToast('已' + (mp.enabled ? '禁用' : '启用') + '：' + mp.name, 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('操作失败：' + e.message, 'error')
  }
}

async function removeMp(name: string) {
  if (!confirm('确认删除挂载点「' + name + '」？该操作会断开连接并从配置移除。')) return
  try {
    await ntripClientApi.deleteMountpoint(name)
    showToast('已删除：' + name, 'success')
    await loadAll()
  } catch (e: any) {
    showToast('删除失败：' + e.message, 'error')
  }
}

async function connectOne(name: string) {
  try {
    await ntripClientApi.connect(name)
    showToast('已发起连接（异步）：' + name, 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('连接失败：' + e.message, 'error')
  }
}
async function disconnectOne(name: string) {
  try {
    await ntripClientApi.disconnect(name)
    showToast('已发起断开（异步）：' + name, 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('断开失败：' + e.message, 'error')
  }
}
async function reconnectOne(name: string) {
  try {
    await ntripClientApi.reconnect(name)
    showToast('已发起重连（异步）：' + name, 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('重连失败：' + e.message, 'error')
  }
}

async function connectAll() {
  try {
    await ntripClientApi.connectAll()
    showToast('已向全部已启用挂载点发起连接（异步）', 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}
async function disconnectAll() {
  try {
    await ntripClientApi.disconnectAll()
    showToast('已向全部挂载点发起断开（异步）', 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}

async function batchEnable() {
  if (!selected.value.length) return showToast('请先勾选挂载点', 'info')
  try {
    await ntripClientApi.batchEnableMountpoints([...selected.value])
    showToast('批量启用已受理（异步）', 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}
async function batchDisable() {
  if (!selected.value.length) return showToast('请先勾选挂载点', 'info')
  try {
    await ntripClientApi.batchDisableMountpoints([...selected.value])
    showToast('批量禁用已受理（异步）', 'success')
    await loadAll()
    refreshAfterCommand()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}
async function batchDelete() {
  if (!selected.value.length) return showToast('请先勾选挂载点', 'info')
  if (!confirm('确认批量删除 ' + selected.value.length + ' 个挂载点？')) return
  try {
    await ntripClientApi.batchDeleteMountpoints([...selected.value])
    showToast('批量删除完成', 'success')
    selected.value = []
    await loadAll()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}

async function resetStats() {
  if (!confirm('确认重置全部挂载点的接收统计？该操作不会中断连接。')) return
  try {
    await ntripClientApi.resetStats()
    showToast('已重置全部统计', 'success')
    await loadAll()
    await loadTabData()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}

/** 重置单个挂载点统计（§4.3.8 POST /stats/{mountpoint}/reset，不中断连接） */
async function resetStatsOne(name: string) {
  if (!confirm('确认重置挂载点「' + name + '」的统计？该操作不会中断连接。')) return
  try {
    await ntripClientApi.resetStatsByMountpoint(name)
    showToast('已重置统计：' + name, 'success')
    await loadAll()
    await loadTabData()
  } catch (e: any) {
    showToast('重置失败：' + e.message, 'error')
  }
}

async function reloadConfig() {
  try {
    await ntripClientApi.reloadConfig()
    showToast('已触发配置重载', 'success')
    await loadAll()
  } catch (e: any) {
    showToast('失败：' + e.message, 'error')
  }
}

// ============ 加载 ============
async function loadAll() {
  loading.value = true
  clearErrs()
  try {
    const [sum, mps, conns] = await Promise.all([
      ntripClientApi.getConnectionsSummary().catch((e) => {
        setErr('连接汇总 /connections/summary', e)
        return null
      }),
      ntripClientApi.listMountpoints().catch((e) => {
        setErr('挂载点列表 /mountpoints', e)
        return []
      }),
      ntripClientApi.listConnections().catch((e) => {
        setErr('连接实例 /connections', e)
        return []
      }),
    ])
    mountpoints.value = (mps as MountpointDTO[]) || []
    connections.value = (conns as any[]) || []
    if (sum) {
      const s = sum as any
      kpi.total = s.total || 0
      kpi.enabled = s.enabled || 0
      kpi.connected = s.connected || 0
      kpi.connecting = (s.connecting || 0) + (s.reconnecting || 0)
      kpi.error = (s.disconnected || 0) + (s.error || 0)
      kpi.rateKbps = s.totalRateKbps || 0
      kpi.bytesReceived = s.totalBytesReceived || 0
      kpi.framesReceived = s.totalFramesReceived || 0
    }
  } catch (e: any) {
    showToast('加载失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function loadTabData() {
  try {
    if (activeTab.value === 'status') {
      statusVO.value = await ntripClientApi.getStatus().catch((e) => {
        setErr('整体状态 /status', e)
        return null
      })
    } else if (activeTab.value === 'stats') {
      statsVO.value = await ntripClientApi.getStats().catch((e) => {
        setErr('接收统计 /stats', e)
        return null
      })
      // 速率历史默认选中第一个挂载点；如果没有则清空历史
      const first = statsVO.value?.mountpoints?.[0]?.mountpoint
      if (first) {
        if (!historyMp.value) historyMp.value = first
        await loadHistory()
      } else {
        historyMp.value = ''
        rateHistory.value = []
      }
    } else if (activeTab.value === 'decode') {
      decodeStats.value = await ntripClientApi.getDecodeStats().catch((e) => {
        setErr('解码统计 /decode-stats', e)
        return []
      })
    } else if (activeTab.value === 'events') {
      // 按挂载点下钻：留空走 /events 与 /alerts（全部）；
      // 选中后走 /events/{mp} 与 /alerts/{mp}（后端返回含全局事件/告警）
      const emp = eventFilterMp.value
      const amp = alertFilterMp.value
      const [ev, al] = await Promise.all([
        (emp ? ntripClientApi.listEventsByMountpoint(emp, 100) : ntripClientApi.listEvents(100)).catch(
          (e) => {
            setErr(`连接事件 /events${emp ? '/' + emp : ''}`, e)
            return []
          },
        ),
        (amp ? ntripClientApi.listAlertsByMountpoint(amp, 50) : ntripClientApi.listAlerts(50)).catch(
          (e) => {
            setErr(`告警 /alerts${amp ? '/' + amp : ''}`, e)
            return []
          },
        ),
      ])
      events.value = ev as any[]
      alerts.value = al as any[]
    } else if (activeTab.value === 'datasources') {
      datasources.value = await ntripClientApi.listDatasources().catch((e) => {
        setErr('数据源 /datasources', e)
        return []
      })
    } else if (activeTab.value === 'monitor') {
      const [h, v, c] = await Promise.all([
        ntripClientApi.health().catch((e) => {
          setErr('健康检查 /health', e)
          return null
        }),
        ntripClientApi.version().catch((e) => {
          setErr('版本信息 /version', e)
          return null
        }),
        ntripClientApi.config().catch((e) => {
          setErr('配置快照 /config', e)
          return null
        }),
      ])
      health.value = h
      versionInfo.value = v
      configSnapshot.value = c
    }
  } catch (e: any) {
    showToast('加载失败：' + e.message, 'error')
  }
}

/**
 * 加载单挂载点速率历史（接口文档 §4.3.6 GET /stats/history）。
 * 这是 MS-01 唯一的时间序列接口，必须传入 mountpoint 与 seconds。
 */
async function loadHistory() {
  const mp = historyMp.value
  if (!mp) return
  historyLoading.value = true
  delete reqErrors[`速率历史 /stats/history?mountpoint=${mp}`]
  try {
    const data = await ntripClientApi
      .getStatsHistory(mp, historySeconds.value)
      .catch((e) => {
        setErr(`速率历史 /stats/history?mountpoint=${mp}`, e)
        return [] as any[]
      })
    // 后端返回的是时间倒序或乱序的内存采样，这里按 time 正序排列便于画折线
    rateHistory.value = ((data as any[]) || [])
      .slice()
      .sort((a: any, b: any) => (a.time || 0) - (b.time || 0))
  } finally {
    historyLoading.value = false
  }
}

function setupSse() {
  if (es) es.close()
  try {
    es = new EventSource(ntripClientApi.streamUrl())

    es.onopen = () => {
      sseState.value = 'open'
    }

    /**
     * 后端推送的是**具名事件**，必须用 addEventListener 订阅；
     * onmessage 只接收未命名事件，这里一个都不会触发。
     * 事件清单（对接指南 §3.4）：
     *   stats            每 1s   NtripStatsVO
     *   decode-stats     每 2s   DecodeStatVO[]
     *   connection-event 发生时  ConnectionEventVO
     *   alert            发生时  AlertVO
     *   心跳             每 15s  SSE 注释（无 data，不触发任何事件）
     */
    const push = (data: unknown) => {
      liveEvents.value.unshift({ ...(data as object), _at: Date.now() })
      if (liveEvents.value.length > 50) liveEvents.value.pop()
    }
    es.addEventListener('stats', (ev) => {
      try {
        push(JSON.parse((ev as MessageEvent).data))
      } catch {
        push({ raw: (ev as MessageEvent).data })
      }
    })
    es.addEventListener('connection-event', (ev) => {
      try {
        push(JSON.parse((ev as MessageEvent).data))
      } catch {
        push({ raw: (ev as MessageEvent).data })
      }
      // 连接事件通常意味着状态已变化，顺带刷新一次
      void loadAll()
    })
    es.addEventListener('alert', (ev) => {
      try {
        push(JSON.parse((ev as MessageEvent).data))
      } catch {
        push({ raw: (ev as MessageEvent).data })
      }
    })
    es.addEventListener('decode-stats', (ev) => {
      try {
        push(JSON.parse((ev as MessageEvent).data))
      } catch {
        push({ raw: (ev as MessageEvent).data })
      }
    })

    es.onerror = () => {
      // EventSource 自带自动重连，这里只暴露状态
      sseState.value = 'error'
    }
  } catch {
    sseState.value = 'error'
  }
}

// ============ 工具 ============
function fmtBytes(n: number | undefined): string {
  if (n == null) return '-'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
function fmtTime(ts: number | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}
function statusClass(s: string | undefined): string {
  if (!s) return 'st-unknown'
  const v = s.toUpperCase()
  if (v === 'CONNECTED') return 'st-ok'
  if (v === 'CONNECTING' || v === 'AUTHENTICATING' || v === 'RECONNECTING') return 'st-warn'
  if (v === 'ERROR' || v === 'DISCONNECTED') return 'st-err'
  if (v === 'DISABLED') return 'st-off'
  return 'st-unknown'
}
function statusText(s: string | undefined): string {
  if (!s) return '未知'
  const map: Record<string, string> = {
    CONNECTED: '已连接',
    CONNECTING: '连接中',
    AUTHENTICATING: '认证中',
    RECONNECTING: '重连中',
    DISCONNECTED: '已断开',
    ERROR: '错误',
    DISABLED: '已禁用',
  }
  return map[s.toUpperCase()] || s
}
function alertClass(lv: string | undefined): string {
  if (!lv) return 'st-unknown'
  const v = lv.toUpperCase()
  if (v === 'CRITICAL') return 'st-err'
  if (v === 'WARN') return 'st-warn'
  return 'st-ok'
}

// ============ 速率历史折线图 ============
const CHART_W = 800
const CHART_H = 200
const CHART_PAD = 32

const historyChartPoints = computed(() => {
  const data = rateHistory.value
  if (!data.length) return []
  const values = data.map((d: any) => d.rateKbps || 0)
  const max = Math.max(...values, 0.001)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  return data.map((d: any, i: number) => ({
    x: CHART_PAD + (i / (data.length - 1 || 1)) * (CHART_W - CHART_PAD * 2),
    y: CHART_H - CHART_PAD - ((d.rateKbps || 0) - min) / range * (CHART_H - CHART_PAD * 2),
    rate: d.rateKbps || 0,
    time: d.time as number | undefined,
  }))
})

const historyLinePath = computed(() => {
  const pts = historyChartPoints.value
  if (!pts.length) return ''
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`
})

const historyAreaPath = computed(() => {
  const pts = historyChartPoints.value
  if (!pts.length) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  const bottomY = CHART_H - CHART_PAD
  const top = pts.map((p) => `${p.x} ${p.y}`).join(' L ')
  return `M ${top} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`
})

// ============ AI 洞察 ============
const aiInsights = computed(() => {
  const out: string[] = []
  if (kpi.connected === 0 && kpi.total > 0) out.push('当前没有任何挂载点处于已连接状态，请检查 Caster 可达性或认证凭据。')
  if (kpi.error > 0) out.push(`存在 ${kpi.error} 个挂载点异常（断开/错误），建议查看事件与告警页定位原因。`)
  if (kpi.connected > 0 && kpi.rateKbps === 0) out.push('已连接但总接收速率为 0，可能存在数据空闲超时，建议核对上游 Caster 是否下发 RTCM3 流。')
  if (kpi.connected > 0 && kpi.rateKbps > 0) out.push(`数据流正常，实时总速率约 ${kpi.rateKbps.toFixed(1)} KB/s。`)
  if (kpi.total === 0) out.push('尚未配置任何挂载点，点击「新增挂载点」接入国家中心或省级 Caster。')
  if (!out.length) out.push('系统运行平稳。')
  return out
})

// ============ 生命周期 ============
let timer: number | undefined
onMounted(async () => {
  await loadAll()
  await loadTabData()
  setupSse()
  timer = window.setInterval(async () => {
    await loadAll()
    if (activeTab.value === 'status' || activeTab.value === 'stats' || activeTab.value === 'decode' || activeTab.value === 'events' || activeTab.value === 'datasources' || activeTab.value === 'monitor') {
      await loadTabData()
    }
  }, 30000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (es) es.close()
})
watch(activeTab, async (t) => {
  if (t === 'monitor') setupSse()
  await loadTabData()
})
// 注意：速率历史**不要**用 watch([historyMp, historySeconds]) 驱动。
// loadTabData 的 stats 分支首次会把 historyMp 从 '' 赋成第一个挂载点，
// 这个赋值本身就会触发 watch，导致 loadHistory 被连调两次（首次进 tab 时必现）。
// 改为：用户改下拉 → 显式 @change 触发；定时刷新 → 由 loadTabData 触发。
</script>

<template>
  <div class="module-view">
    <ConnectionStatus service-name="实时连接服务" :port="18081" health-path="/api/v1/ntrip-client/health" mode="real" />
    <!-- 顶部标题 -->
    <header class="mv-header">
      <div>
        <h1 class="mv-title">实时数据连接管理</h1>
        <p class="mv-sub">
          NTRIP 客户端服务（ntrip-client-service）｜ 多挂载点 RTCM3 数据流订阅 ｜ 端口 18081
          <span class="sse-badge" :class="sseState">
            SSE {{ sseState === 'open' ? '已连接' : sseState === 'error' ? '中断重连中' : '未连接' }}
          </span>
        </p>
      </div>
      <div class="mv-actions">
        <button class="btn btn-primary" @click="connectAll">连接全部</button>
        <button class="btn btn-ghost" @click="disconnectAll">断开全部</button>
        <button class="btn btn-ghost" @click="reloadConfig">重载配置</button>
        <button class="btn btn-primary" @click="openCreateMp">+ 新增挂载点</button>
      </div>
    </header>

    <!-- 接口错误汇总：后端未启动时在此集中暴露真实报错（纯真实模式，无演示数据兜底） -->
    <div v-if="errorList.length" class="req-errors">
      <div class="req-errors-head">
        <strong>接口请求失败 {{ errorList.length }} 项</strong>
        <span>以下为后端返回的原始错误，本页未做任何演示数据兜底</span>
        <button class="req-errors-close" @click="clearErrs">×</button>
      </div>
      <ul>
        <li v-for="e in errorList" :key="e.key">
          <code>{{ e.key }}</code>
          <span>{{ e.msg }}</span>
        </li>
      </ul>
    </div>

    <!-- KPI -->
    <section class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">挂载点总数</div><div class="kpi-val">{{ kpi.total }}</div></div>
      <div class="kpi-card"><div class="kpi-label">已启用</div><div class="kpi-val">{{ kpi.enabled }}</div></div>
      <div class="kpi-card ok"><div class="kpi-label">已连接</div><div class="kpi-val">{{ kpi.connected }}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">连接中/重连中</div><div class="kpi-val">{{ kpi.connecting }}</div></div>
      <div class="kpi-card err"><div class="kpi-label">异常/断开</div><div class="kpi-val">{{ kpi.error }}</div></div>
      <div class="kpi-card"><div class="kpi-label">总接收速率</div><div class="kpi-val">{{ kpi.rateKbps.toFixed(1) }}<span class="kpi-unit">KB/s</span></div></div>
      <div class="kpi-card"><div class="kpi-label">累计接收字节</div><div class="kpi-val">{{ fmtBytes(kpi.bytesReceived) }}</div></div>
      <div class="kpi-card"><div class="kpi-label">累计帧数</div><div class="kpi-val">{{ kpi.framesReceived.toLocaleString() }}</div></div>
    </section>

    <!-- AI 洞察 -->
    <section class="ai-insight">
      <span class="ai-tag">AI 洞察</span>
      <ul>
        <li v-for="(t, i) in aiInsights" :key="i">{{ t }}</li>
      </ul>
    </section>

    <!-- Tabs -->
    <nav class="tabs">
      <button v-for="t in ['mountpoints','connections','status','stats','decode','events','datasources','monitor']" :key="t"
        class="tab" :class="{ active: activeTab === t }" @click="activeTab = t">
        {{ { mountpoints:'挂载点管理', connections:'连接控制', status:'状态监控', stats:'接收统计', decode:'解码统计', events:'事件告警', datasources:'数据源', monitor:'监控运维' }[t] }}
      </button>
    </nav>

    <section class="tab-body">
      <!-- Tab1 挂载点管理 -->
      <div v-if="activeTab === 'mountpoints'">
        <div class="toolbar">
          <button class="btn btn-sm btn-ghost" @click="batchEnable">批量启用</button>
          <button class="btn btn-sm btn-ghost" @click="batchDisable">批量禁用</button>
          <button class="btn btn-sm btn-danger" @click="batchDelete">批量删除</button>
          <span class="toolbar-info">已选 {{ selected.length }} 项</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th><input type="checkbox" :checked="selected.length === mountpoints.length && mountpoints.length" @change="(e:any)=>selected = e.target.checked ? mountpoints.map(m=>m.name||'') : []" /></th>
              <th>挂载点</th><th>启用</th><th>格式</th><th>卫星系统</th><th>认证</th><th>状态</th><th>速率</th><th>累计字节</th><th>时长(s)</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="mp in mountpoints" :key="mp.name">
              <td><input type="checkbox" :checked="selected.includes(mp.name||'')" @change="(e:any)=>{ e.target.checked ? selected.push(mp.name||'') : selected = selected.filter(n=>n!==mp.name) }" /></td>
              <td class="strong">{{ mp.name }}</td>
              <td>{{ mp.enabled ? '是' : '否' }}</td>
              <td>{{ mp.format }}</td>
              <td>{{ mp.satelliteSystems }}</td>
              <td>{{ mp.authRequired ? '需要' : '无' }}</td>
              <td><span class="st" :class="statusClass(mp.status)">{{ statusText(mp.status) }}</span></td>
              <td>{{ (mp.receiveRateKbps||0).toFixed(1) }} KB/s</td>
              <td>{{ fmtBytes(mp.bytesReceived) }}</td>
              <td>{{ mp.durationSec ?? '-' }}</td>
              <td class="ops">
                <button class="mini" @click="connectOne(mp.name||'')">连接</button>
                <button class="mini" @click="disconnectOne(mp.name||'')">断开</button>
                <button class="mini" @click="toggleMp(mp)">{{ mp.enabled ? '禁用' : '启用' }}</button>
                <button class="mini" @click="openEditMp(mp)">编辑</button>
                <button class="mini danger" @click="removeMp(mp.name||'')">删除</button>
              </td>
            </tr>
            <tr v-if="!mountpoints.length"><td colspan="11" class="empty">暂无挂载点，点击「新增挂载点」接入 Caster</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab2 连接控制 -->
      <div v-if="activeTab === 'connections'">
        <div class="toolbar">
          <button class="btn btn-sm btn-primary" @click="connectAll">连接全部</button>
          <button class="btn btn-sm btn-ghost" @click="disconnectAll">断开全部</button>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>挂载点</th><th>状态</th><th>Caster</th><th>时长(s)</th><th>空闲(s)</th><th>重连次数</th><th>状态说明</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in connections" :key="c.mountpoint">
              <td class="strong">{{ c.mountpoint }}</td>
              <td><span class="st" :class="statusClass(c.status)">{{ statusText(c.status) }}</span></td>
              <td>{{ c.casterHost }}:{{ c.casterPort }}</td>
              <td>{{ c.durationSec ?? '-' }}</td>
              <td>{{ c.dataIdleSec ?? '-' }}</td>
              <td>{{ c.reconnectAttempts ?? 0 }}</td>
              <td class="muted">{{ c.statusMessage || '-' }}</td>
              <td class="ops">
                <button class="mini" @click="connectOne(c.mountpoint)">连接</button>
                <button class="mini" @click="disconnectOne(c.mountpoint)">断开</button>
                <button class="mini" @click="reconnectOne(c.mountpoint)">重连</button>
              </td>
            </tr>
            <tr v-if="!connections.length"><td colspan="8" class="empty">暂无连接实例</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab3 状态监控 -->
      <div v-if="activeTab === 'status'">
        <div v-if="statusVO" class="grid-2">
          <div class="panel">
            <h3>整体状态</h3>
            <p>启动时间：{{ fmtTime(statusVO.startedAt) }}</p>
            <p>挂载点总数：{{ statusVO.totalMountpoints }}</p>
            <p>已连接：{{ statusVO.connectedCount }} ｜ 连接中：{{ statusVO.connectingCount }} ｜ 重连中：{{ statusVO.reconnectingCount }} ｜ 断开：{{ statusVO.disconnectedCount }} ｜ 错误：{{ statusVO.errorCount }}</p>
          </div>
          <div class="panel">
            <h3>逐挂载点状态</h3>
            <table class="data-table compact">
              <thead><tr><th>挂载点</th><th>状态</th><th>时长(s)</th><th>空闲(s)</th></tr></thead>
              <tbody>
                <tr v-for="c in (statusVO.connections||[])" :key="c.mountpoint">
                  <td class="strong">{{ c.mountpoint }}</td>
                  <td><span class="st" :class="statusClass(c.status)">{{ statusText(c.status) }}</span></td>
                  <td>{{ c.durationSec ?? '-' }}</td>
                  <td>{{ c.dataIdleSec ?? '-' }}</td>
                </tr>
                <tr v-if="!(statusVO.connections||[]).length"><td colspan="4" class="empty">无</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="empty">暂无数据，请确认后端已启动</div>
      </div>

      <!-- Tab4 接收统计 -->
      <div v-if="activeTab === 'stats'">
        <div v-if="statsVO">
          <div class="grid-2">
            <div class="panel">
              <h3>整体接收统计</h3>
              <p>总速率：{{ (statsVO.totalReceiveRateKbps||0).toFixed(1) }} KB/s</p>
              <p>累计字节：{{ fmtBytes(statsVO.totalBytesReceived) }}</p>
              <p>累计帧数：{{ (statsVO.totalFramesReceived||0).toLocaleString() }}</p>
              <p>平均帧大小：{{ (statsVO.avgFrameSizeBytes||0).toFixed(1) }} B</p>
              <button class="btn btn-sm btn-danger" @click="resetStats">重置统计</button>
            </div>
            <div class="panel">
              <h3>逐挂载点统计</h3>
              <table class="data-table compact">
                <thead><tr><th>挂载点</th><th>状态</th><th>速率</th><th>字节</th><th>帧数</th><th>平均帧(B)</th><th>操作</th></tr></thead>
                <tbody>
                  <tr v-for="m in (statsVO.mountpoints||[])" :key="m.mountpoint">
                    <td class="strong">{{ m.mountpoint }}</td>
                    <td><span class="st" :class="statusClass(m.status)">{{ statusText(m.status) }}</span></td>
                    <td>{{ (m.receiveRateKbps||0).toFixed(1) }}</td>
                    <td>{{ fmtBytes(m.bytesReceived) }}</td>
                    <td>{{ (m.framesReceived||0).toLocaleString() }}</td>
                    <td>{{ (m.avgFrameSizeBytes||0).toFixed(1) }}</td>
                    <td><button class="mini" @click="resetStatsOne(m.mountpoint)">重置统计</button></td>
                  </tr>
                  <tr v-if="!(statsVO.mountpoints||[]).length"><td colspan="7" class="empty">无</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 速率历史：MS-01 唯一时间序列接口（§4.3.6 GET /stats/history） -->
          <div class="panel chart-panel">
            <div class="chart-header">
              <h3>速率历史</h3>
              <div class="chart-controls">
                <select v-model="historyMp" :disabled="historyLoading" @change="loadHistory">
                  <option value="">选择挂载点</option>
                  <option v-for="m in (statsVO.mountpoints||[])" :key="m.mountpoint" :value="m.mountpoint">{{ m.mountpoint }}</option>
                </select>
                <select v-model.number="historySeconds" :disabled="historyLoading" @change="loadHistory">
                  <option :value="60">最近 60 秒</option>
                  <option :value="300">最近 5 分钟</option>
                  <option :value="600">最近 10 分钟</option>
                  <option :value="1800">最近 30 分钟</option>
                  <option :value="3600">最近 1 小时</option>
                </select>
                <button class="btn btn-sm btn-ghost" :disabled="historyLoading" @click="loadHistory">刷新</button>
              </div>
            </div>
            <div v-if="historyLoading" class="empty">加载中…</div>
            <div v-else-if="!historyChartPoints.length" class="empty">暂无 {{ historySeconds }} 秒内「{{ historyMp || '-' }}」的速率数据</div>
            <svg v-else class="rate-chart" viewBox="0 0 800 200" preserveAspectRatio="none">
              <!-- 网格线 -->
              <line v-for="i in 5" :key="'h'+i" x1="32" :y1="32+(i-1)*34" x2="768" :y2="32+(i-1)*34" stroke="#f0f0f0" />
              <line v-for="i in 6" :key="'v'+i" :x1="32+(i-1)*147.2" y1="32" :x2="32+(i-1)*147.2" y2="168" stroke="#f0f0f0" />
              <!-- 面积与折线 -->
              <path class="area" :d="historyAreaPath" />
              <path class="line" :d="historyLinePath" />
              <!-- 数据点 -->
              <circle v-for="(p, i) in historyChartPoints" :key="i" :cx="p.x" :cy="p.y" r="3">
                <title>{{ fmtTime(p.time) }} · {{ p.rate.toFixed(2) }} KB/s</title>
              </circle>
            </svg>
          </div>
        </div>
        <div v-else class="empty">暂无数据，请确认后端已启动</div>
      </div>

      <!-- Tab5 解码统计 -->
      <div v-if="activeTab === 'decode'">
        <table class="data-table">
          <thead><tr><th>挂载点</th><th>解码启用</th><th>投喂</th><th>成功</th><th>失败</th><th>成功率</th><th>历元</th><th>星历</th><th>SSR</th><th>最近消息类型</th></tr></thead>
          <tbody>
            <tr v-for="d in decodeStats" :key="d.mountpoint">
              <td class="strong">{{ d.mountpoint }}</td>
              <td>{{ d.enabled ? '是' : '否' }}</td>
              <td>{{ d.totalMessages ?? 0 }}</td>
              <td>{{ d.decodedMessages ?? 0 }}</td>
              <td>{{ d.failedMessages ?? 0 }}</td>
              <td><span class="st" :class="(d.successRate||0) >= 0.9 ? 'st-ok' : (d.successRate||0) >= 0.5 ? 'st-warn' : 'st-err'">{{ ((d.successRate||0)*100).toFixed(1) }}%</span></td>
              <td>{{ d.observationEpochs ?? 0 }}</td>
              <td>{{ d.ephemerisMessages ?? 0 }}</td>
              <td>{{ d.ssrMessages ?? 0 }}</td>
              <td>{{ d.lastMessageType ?? '-' }}</td>
            </tr>
            <tr v-if="!decodeStats.length"><td colspan="10" class="empty">暂无解码统计</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab6 事件 / 告警 -->
      <div v-if="activeTab === 'events'">
        <div class="grid-2">
          <div class="panel">
            <div class="panel-head">
              <h3>最近连接事件</h3>
              <select v-model="eventFilterMp" class="mp-filter" @change="loadTabData">
                <option value="">全部挂载点</option>
                <option v-for="mp in mountpoints" :key="mp.name" :value="mp.name || ''">{{ mp.name }}</option>
              </select>
            </div>
            <table class="data-table compact">
              <thead><tr><th>时间</th><th>挂载点</th><th>类型</th><th>消息</th></tr></thead>
              <tbody>
                <tr v-for="(e,i) in events" :key="i">
                  <td>{{ fmtTime(e.time) }}</td><td>{{ e.mountpoint }}</td><td>{{ e.eventType }}</td><td class="muted">{{ e.message }}</td>
                </tr>
                <tr v-if="!events.length"><td colspan="4" class="empty">{{ eventFilterMp ? '「' + eventFilterMp + '」无事件' : '无事件' }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="panel">
            <div class="panel-head">
              <h3>最近告警</h3>
              <select v-model="alertFilterMp" class="mp-filter" @change="loadTabData">
                <option value="">全部挂载点</option>
                <option v-for="mp in mountpoints" :key="mp.name" :value="mp.name || ''">{{ mp.name }}</option>
              </select>
            </div>
            <table class="data-table compact">
              <thead><tr><th>级别</th><th>挂载点</th><th>消息</th><th>时间</th></tr></thead>
              <tbody>
                <tr v-for="(a,i) in alerts" :key="i">
                  <td><span class="st" :class="alertClass(a.level)">{{ a.level }}</span></td>
                  <td>{{ a.mountpoint }}</td><td class="muted">{{ a.message }}</td><td>{{ fmtTime(a.time) }}</td>
                </tr>
                <tr v-if="!alerts.length"><td colspan="4" class="empty">{{ alertFilterMp ? '「' + alertFilterMp + '」无告警' : '无告警' }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Tab7 数据源 -->
      <div v-if="activeTab === 'datasources'">
        <table class="data-table">
          <thead><tr><th>类型</th><th>名称</th><th>运行中</th><th>运行开始</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="(d,i) in datasources" :key="i">
              <td class="strong">{{ d.type }}</td><td>{{ d.name }}</td>
              <td><span class="st" :class="d.running ? 'st-ok' : 'st-off'">{{ d.running ? '运行中' : '停止' }}</span></td>
              <td>{{ fmtTime(d.runningSince) }}</td><td class="muted">{{ d.description }}</td>
            </tr>
            <tr v-if="!datasources.length"><td colspan="5" class="empty">无数据源适配器</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab8 监控运维 -->
      <div v-if="activeTab === 'monitor'">
        <div class="grid-2">
          <div class="panel">
            <h3>健康检查</h3>
            <p v-if="health">状态：<span class="st" :class="health.status==='UP' ? 'st-ok' : health.status==='DOWN' ? 'st-err' : 'st-warn'">{{ health.status }}</span></p>
            <p v-if="health">服务：{{ health.service }} ｜ 版本：{{ health.version }}</p>
            <p v-if="health">运行时长：{{ (health.uptimeSec||0) }} s ｜ SSE 订阅者：{{ health.sseSubscribers ?? '-' }}</p>
            <div v-if="health && health.components">
              <p>组件可用性：</p>
              <ul class="kv">
                <li v-for="(c, i) in health.components" :key="i"><span class="st" :class="c.status==='UP' ? 'st-ok' : c.status==='DOWN' ? 'st-err' : 'st-warn'">{{ c.status }}</span> {{ c.name }} - {{ c.detail }}</li>
              </ul>
            </div>
          </div>
          <div class="panel">
            <h3>版本信息</h3>
            <pre class="code">{{ versionInfo ? JSON.stringify(versionInfo, null, 2) : '（空）' }}</pre>
          </div>
          <div class="panel">
            <h3>配置快照（脱敏）</h3>
            <pre class="code">{{ configSnapshot ? JSON.stringify(configSnapshot, null, 2) : '（空）' }}</pre>
          </div>
          <div class="panel">
            <h3>SSE 实时事件流</h3>
            <p class="muted">订阅地址：{{ ntripClientApi.streamUrl() }}（后端未启动时为空态）</p>
            <div class="sse-box">
              <div v-for="(e, i) in liveEvents" :key="i" class="sse-line">{{ fmtTime(e.time || Date.now()) }} · {{ JSON.stringify(e) }}</div>
              <div v-if="!liveEvents.length" class="empty">等待实时事件…</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 模态框：新增/编辑挂载点 -->
    <div v-if="showMpModal" class="modal-mask" @click.self="showMpModal = false">
      <div class="modal">
        <h3>{{ mpModalMode === 'create' ? '新增挂载点' : '编辑挂载点' }}</h3>
        <div v-if="mpModalMode === 'create'" class="preset-row">
          <span>快速模板：</span>
          <button type="button" class="btn btn-mini" @click="applyPreset('hksc32')">SatRef · HKSC_32（昂船洲）</button>
          <a href="http://www.geodetic.gov.hk/common/data/pdf/SatRef_NTRIP_application_form.pdf" target="_blank" rel="noopener" class="satref-link">SatRef 账号申请表</a>
        </div>
        <div class="form-grid">
          <label>挂载点名称 <input v-model="mpForm.name" :disabled="mpModalMode==='edit'" /></label>
          <label>数据格式 <input v-model="mpForm.format" placeholder="RTCM3" /></label>
          <label>卫星系统 <input v-model="mpForm.satelliteSystems" placeholder="GPS+BDS+GLONASS+Galileo" /></label>
          <label>数据源说明 <input v-model="mpForm.sourceDescription" /></label>
          <label class="full">Caster 主机 <input v-model="mpForm.casterHost" placeholder="留空回退全局" /></label>
          <label>Caster 端口 <input v-model.number="mpForm.casterPort" type="number" placeholder="留空回退全局" /></label>
          <label>TCP 超时(ms) <input v-model.number="mpForm.connectTimeoutMs" type="number" placeholder="留空回退全局" /></label>
          <label>空闲超时(s) <input v-model.number="mpForm.idleTimeoutSec" type="number" placeholder="留空回退全局" /></label>
          <label>CRC-24Q 校验
            <select v-model="mpForm.crcCheck">
              <option :value="null">回退全局</option>
              <option :value="true">开启</option>
              <option :value="false">关闭</option>
            </select>
          </label>
          <label>RTCM 解码统计
            <select v-model="mpForm.decodeEnabled">
              <option :value="null">回退全局</option>
              <option :value="true">开启</option>
              <option :value="false">关闭</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" v-model="mpForm.enabled" /> 启用（立即建连）</label>
          <label class="check"><input type="checkbox" v-model="mpForm.authRequired" /> 需要认证</label>
          <label v-if="mpForm.authRequired">用户名 <input v-model="mpForm.username" /></label>
          <label v-if="mpForm.authRequired">密码 <input v-model="mpForm.password" type="password" placeholder="留空不修改" /></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showMpModal = false">取消</button>
          <button class="btn btn-primary" @click="submitMp">保存</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast.show" class="toast" :class="toast.type">{{ toast.msg }}</div>
  </div>
</template>

<style scoped>
.module-view { padding: 20px 24px 40px; }
.mv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.mv-title { font-size: 22px; font-weight: 600; color: #1a1a2e; margin: 0; }
.mv-sub { font-size: 13px; color: #888; margin: 6px 0 0; }
.mv-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.kpi-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px; margin-bottom: 14px; }
.kpi-card { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 14px 12px; }
.kpi-label { font-size: 12px; color: #8a94a6; }
.kpi-val { font-size: 24px; font-weight: 600; color: #1a1a2e; margin-top: 6px; }
.kpi-unit { font-size: 12px; color: #8a94a6; margin-left: 4px; font-weight: 400; }
.kpi-card.ok .kpi-val { color: #52c41a; }
.kpi-card.warn .kpi-val { color: #fa8c16; }
.kpi-card.err .kpi-val { color: #f5222d; }

.ai-insight { background: linear-gradient(90deg, rgba(24,144,255,0.06), rgba(114,46,209,0.04)); border: 1px solid #e6f0ff; border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; display: flex; gap: 12px; align-items: flex-start; }
.ai-tag { background: linear-gradient(135deg, #1890ff, #722ed1); color: #fff; font-size: 12px; padding: 3px 10px; border-radius: 10px; font-weight: 600; flex-shrink: 0; }
.ai-insight ul { margin: 0; padding-left: 18px; color: #405060; font-size: 13px; }
.ai-insight li { margin: 2px 0; }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid #eef0f3; margin-bottom: 16px; flex-wrap: wrap; }
.tab { border: none; background: transparent; padding: 10px 16px; font-size: 14px; color: #595959; cursor: pointer; border-bottom: 2px solid transparent; }
.tab:hover { color: #1890ff; }
.tab.active { color: #1890ff; font-weight: 600; border-bottom-color: #1890ff; }

.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.toolbar-info { font-size: 12px; color: #8a94a6; margin-left: auto; }

.data-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #eef0f3; }
.data-table th, .data-table td { padding: 10px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid #f2f4f7; }
.data-table th { background: #fafbfc; color: #5a6577; font-weight: 600; }
.data-table tr:hover td { background: #f9fbff; }
.data-table.compact th, .data-table.compact td { padding: 7px 10px; font-size: 12px; }
.strong { font-weight: 600; color: #1a1a2e; }
.muted { color: #8a94a6; }
.empty { text-align: center; color: #b0b8c4; padding: 24px; }

.st { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 12px; font-weight: 500; }
.st-ok { background: #e9f9ec; color: #389e0d; }
.st-warn { background: #fff7e6; color: #d46b08; }
.st-err { background: #fff1f0; color: #cf1322; }
.st-off { background: #f0f2f5; color: #8a94a6; }
.st-unknown { background: #f0f2f5; color: #8a94a6; }

.ops { display: flex; gap: 4px; flex-wrap: wrap; }
.mini { border: 1px solid #d9e1ec; background: #fff; border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer; color: #1890ff; }
.mini:hover { background: #e6f7ff; }
.mini.danger { color: #f5222d; border-color: #ffccc7; }
.mini.danger:hover { background: #fff1f0; }

.btn { border: 1px solid #d9e1ec; background: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #333; }
.btn:hover { border-color: #1890ff; color: #1890ff; }
.btn-primary { background: #1890ff; color: #fff; border-color: #1890ff; }
.btn-primary:hover { background: #40a9ff; color: #fff; }
.btn-ghost { background: #fafbfc; }
.btn-danger { color: #f5222d; border-color: #ffccc7; }
.btn-danger:hover { background: #fff1f0; color: #f5222d; }
.btn-sm { padding: 5px 10px; font-size: 12px; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.panel { background: #fff; border: 1px solid #eef0f3; border-radius: 10px; padding: 16px; }
.panel h3 { margin: 0 0 12px; font-size: 15px; color: #1a1a2e; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
.panel-head h3 { margin: 0; }
.mp-filter { border: 1px solid #d9e1ec; border-radius: 6px; padding: 5px 8px; font-size: 13px; background: #fff; color: #333; flex-shrink: 0; }
.mp-filter:focus { outline: none; border-color: #1890ff; }
.panel p { font-size: 13px; color: #405060; margin: 4px 0; }
.kv { list-style: none; padding: 0; margin: 6px 0; font-size: 12px; }
.kv li { margin: 4px 0; display: flex; gap: 8px; align-items: center; }
.code { background: #f7f9fc; border: 1px solid #eef0f3; border-radius: 8px; padding: 10px; font-size: 12px; color: #405060; max-height: 260px; overflow: auto; white-space: pre-wrap; }

.sse-box { background: #0f1115; border-radius: 8px; padding: 10px; height: 220px; overflow: auto; font-family: monospace; font-size: 12px; }
.sse-line { color: #7ee787; padding: 2px 0; border-bottom: 1px solid #1c2027; white-space: pre-wrap; word-break: break-all; }

.modal-mask { position: fixed; inset: 0; background: rgba(20,28,40,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 14px; padding: 22px; width: 560px; max-width: 92vw; max-height: 88vh; overflow: auto; }
.modal h3 { margin: 0 0 16px; font-size: 17px; color: #1a1a2e; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-grid label { font-size: 12px; color: #5a6577; display: flex; flex-direction: column; gap: 4px; }
.form-grid label.full { grid-column: 1 / -1; }
.form-grid label.check { flex-direction: row; align-items: center; gap: 6px; }
.form-grid input { border: 1px solid #d9e1ec; border-radius: 7px; padding: 7px 9px; font-size: 13px; }
.form-grid input:focus { outline: none; border-color: #1890ff; }
.form-grid select { border: 1px solid #d9e1ec; border-radius: 7px; padding: 7px 9px; font-size: 13px; background: #fff; color: #333; }
.form-grid select:focus { outline: none; border-color: #1890ff; }

/* ---------- 速率历史折线图 ---------- */
.chart-panel { margin-top: 16px; }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.chart-header h3 { margin: 0; font-size: 15px; color: #1a1a2e; }
.chart-controls { display: flex; gap: 8px; align-items: center; }
.chart-controls select { border: 1px solid #d9e1ec; border-radius: 6px; padding: 5px 8px; font-size: 13px; background: #fff; color: #333; }
.chart-controls select:focus { outline: none; border-color: #1890ff; }
.chart-controls select:disabled { opacity: 0.6; background: #f5f5f5; }
.rate-chart { width: 100%; height: 220px; display: block; }
.rate-chart .area { fill: rgba(24,144,255,0.12); stroke: none; }
.rate-chart .line { fill: none; stroke: #1890ff; stroke-width: 2; }
.rate-chart circle { fill: #1890ff; cursor: pointer; }
.rate-chart circle:hover { r: 5; }

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

.toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 8px; font-size: 13px; color: #fff; z-index: 60; box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
.toast.info { background: #1890ff; }
.toast.success { background: #52c41a; }
.toast.error { background: #f5222d; }

/* ---------- 接口错误汇总 ---------- */
.req-errors {
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.req-errors-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #cf1322;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.req-errors-head span {
  color: #888;
  font-size: 12px;
  font-weight: 400;
}
.req-errors-close {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 18px;
  line-height: 1;
  color: #cf1322;
  opacity: 0.6;
  cursor: pointer;
}
.req-errors-close:hover { opacity: 1; }
.req-errors ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.req-errors li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  color: #cf1322;
  word-break: break-all;
}
.req-errors li code {
  flex-shrink: 0;
  background: rgba(207, 19, 34, 0.08);
  border-radius: 4px;
  padding: 1px 6px;
  font-family: 'SF Mono', Consolas, Monaco, monospace;
  font-size: 11px;
}

/* ---------- SSE 状态 ---------- */
.sse-badge {
  display: inline-block;
  margin-left: 8px;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  background: #f0f0f0;
  color: #999;
  vertical-align: middle;
}
.sse-badge.open { background: #f6ffed; color: #52c41a; }
.sse-badge.error { background: #fff2f0; color: #ff4d4f; }

.preset-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -6px 0 14px;
  padding: 10px 12px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 8px;
  font-size: 12px;
  color: #555;
}
.preset-row span { color: #888; }
.satref-link {
  margin-left: auto;
  color: #1890ff;
  text-decoration: none;
}
.satref-link:hover { text-decoration: underline; }
.btn-mini {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #b7eb8f;
  background: #fff;
  color: #52c41a;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-mini:hover {
  background: #f6ffed;
  border-color: #52c41a;
}
</style>
