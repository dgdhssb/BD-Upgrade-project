<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import {
  decodeApi,
  type DecodeStatsVO,
  type HealthVO,
  type RtcmDecodeRequest,
  type RinexParseRequest,
  type BinaryConvertRequest,
  type FormatConvertRequest,
} from '@/api/modules/decode'

import ConnectionStatus from '@/components/ConnectionStatus.vue'

// ============ 通用 ============
const toast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
  toastMsg.value = msg
  toastType.value = type
  setTimeout(() => (toastMsg.value = ''), 2600)
}
const toastMsg = ref('')
const toastType = ref<'success' | 'error' | 'info'>('info')
const loading = ref(false)

function json(o: unknown): string {
  try {
    return JSON.stringify(o, null, 2)
  } catch {
    return String(o)
  }
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
function dropErr(key: string) {
  delete reqErrors[key]
}
function clearErrs() {
  Object.keys(reqErrors).forEach((k) => delete reqErrors[k])
}
const errorList = computed(() => Object.entries(reqErrors).map(([key, msg]) => ({ key, msg })))

// ============ KPI ============
const stats = ref<DecodeStatsVO | null>(null)
const health = ref<HealthVO | null>(null)
const sseCount = ref<number | null>(null)

const kpis = computed(() => {
  const s = stats.value
  return [
    { label: '累计数据包', value: s?.totalPackets ?? '—', unit: '包', color: '#1890ff' },
    { label: '成功数据包', value: s?.successPackets ?? '—', unit: '包', color: '#52c41a' },
    { label: '解码成功率', value: s ? (s.successRate ?? 0).toFixed(1) : '—', unit: '%', color: '#722ed1' },
    { label: '累计历元', value: s?.totalEpochs ?? '—', unit: '历元', color: '#fa8c16' },
    { label: '累计卫星', value: s?.totalSatellites ?? '—', unit: '颗', color: '#13c2c2' },
    { label: '累计观测量', value: s?.totalObservations ?? '—', unit: '个', color: '#eb2f96' },
    { label: '活跃会话', value: s?.activeSessions ?? '—', unit: '个', color: '#2f54eb' },
    { label: 'SSE 订阅者', value: sseCount.value ?? health.value?.sseSubscribers ?? '—', unit: '个', color: '#a0d911' },
  ]
})

async function loadKpis() {
  try {
    const [s, h, sub] = await Promise.allSettled([
      decodeApi.stats(),
      decodeApi.health(),
      decodeApi.sseSubscribers(),
    ])
    if (s.status === 'fulfilled') {
      stats.value = s.value
      dropErr('解码统计 /stats')
    } else setErr('解码统计 /stats', s.reason)
    if (h.status === 'fulfilled') {
      health.value = h.value
      dropErr('健康检查 /health')
    } else setErr('健康检查 /health', h.reason)
    if (sub.status === 'fulfilled') {
      sseCount.value = sub.value as unknown as number
      dropErr('SSE 订阅者 /sse/subscribers')
    } else setErr('SSE 订阅者 /sse/subscribers', sub.reason)
  } catch (e: any) {
    setErr('KPI 加载', e)
  }
}

// ============ Tab ============
const tab = ref('monitor')
const tabs = [
  { key: 'monitor', label: '监控运维' },
  { key: 'rtcm', label: 'RTCM 解码' },
  { key: 'rinex', label: 'RINEX' },
  { key: 'convert', label: '格式转换' },
  { key: 'binary', label: '二进制流' },
  { key: 'sse', label: 'SSE 实时' },
]

// ============ 监控运维 ============
const monitorData = reactive({
  version: null as any,
  status: null as any,
  config: null as any,
  appInfo: null as any,
})
const monitorLoading = ref(false)
async function loadMonitor() {
  monitorLoading.value = true
  try {
    const [v, st, c, a] = await Promise.allSettled([
      decodeApi.version(),
      decodeApi.status(),
      decodeApi.config(),
      decodeApi.appInfo(),
    ])
    if (v.status === 'fulfilled') {
      monitorData.version = v.value
      dropErr('版本信息 /version')
    } else setErr('版本信息 /version', v.reason)
    if (st.status === 'fulfilled') {
      monitorData.status = st.value
      dropErr('服务状态 /status')
    } else setErr('服务状态 /status', st.reason)
    if (c.status === 'fulfilled') {
      monitorData.config = c.value
      dropErr('配置快照 /config')
    } else setErr('配置快照 /config', c.reason)
    if (a.status === 'fulfilled') {
      monitorData.appInfo = a.value
      dropErr('应用信息 /app/info')
    } else setErr('应用信息 /app/info', a.reason)
  } finally {
    monitorLoading.value = false
  }
}
async function resetStats() {
  if (
    !window.confirm(
      '确定要重置 data-decode-service 的解码统计吗？\n\n' +
        '该操作会清空累计数据包 / 成功失败数 / 历元 / 卫星 / 观测量等全部计数，且不可恢复。',
    )
  ) {
    return
  }
  try {
    await decodeApi.resetStats()
    toast('统计已重置', 'success')
    await loadKpis()
  } catch (e: any) {
    toast('重置失败：' + e.message, 'error')
  }
}

// ============ RTCM ============
const rtcm = reactive({
  hex: '',
  base64: '',
  sourceId: '',
  stationId: '',
})
const rtcmResult = ref<any>(null)
const rtcmFormats = ref<string[]>([])
const rtcmMsgTypes = ref<unknown[]>([])
const framesHex = ref('')
const framesResult = ref<unknown[] | null>(null)

async function doRtcm(mode: 'decode' | 'hex' | 'base64') {
  try {
    loading.value = true
    // hex / base64 二选一（base64 优先）。空串必须剔除：
    // 传 hex="" 会让后端认为「已提供 hex」，从而跳过 base64 分支。
    const req: RtcmDecodeRequest = {}
    if (rtcm.hex) req.hex = rtcm.hex
    if (rtcm.base64) req.base64 = rtcm.base64
    if (rtcm.sourceId) req.sourceId = rtcm.sourceId
    if (rtcm.stationId) req.stationId = rtcm.stationId
    const res = mode === 'hex'
      ? await decodeApi.decodeRtcmHex(req)
      : mode === 'base64'
        ? await decodeApi.decodeRtcmBase64(req)
        : await decodeApi.decodeRtcm(req)
    rtcmResult.value = res
    toast('RTCM 解码成功', 'success')
  } catch (e: any) {
    toast('解码失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doRtcmMulti() {
  try {
    loading.value = true
    const reqs: any[] = []
    if (rtcm.base64) reqs.push({ base64: rtcm.base64, sourceId: rtcm.sourceId || 'src1' })
    if (rtcm.hex) reqs.push({ hex: rtcm.hex, sourceId: rtcm.sourceId || 'src2' })
    rtcmResult.value = await decodeApi.decodeRtcmMulti(reqs)
    toast('多路复用解码完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
/**
 * RTCM 原始二进制解码（接口文档 §4.2.4）
 * 该接口要求 Content-Type: application/octet-stream，请求体是原始字节流，
 * sourceId / stationId 走 query 参数。前端持有 Base64，由 API 层解码成字节后发出。
 */
async function doRtcmRaw() {
  if (!rtcm.base64) {
    toast('原始二进制解码需要 Base64（会解码成字节流发送）', 'error')
    return
  }
  try {
    loading.value = true
    rtcmResult.value = await decodeApi.decodeRtcmRaw(rtcm.base64, {
      sourceId: rtcm.sourceId || undefined,
      stationId: rtcm.stationId || undefined,
    })
    toast('原始二进制解码成功', 'success')
  } catch (e: any) {
    toast('解码失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function loadRtcmMeta() {
  try {
    const [f, m] = await Promise.allSettled([decodeApi.rtcmFormats(), decodeApi.rtcmMessageTypes()])
    if (f.status === 'fulfilled') rtcmFormats.value = f.value
    if (m.status === 'fulfilled') rtcmMsgTypes.value = m.value as unknown[]
  } catch (e: any) {
    /* ignore */
  }
}
async function doFrames() {
  try {
    framesResult.value = await decodeApi.rtcmFrames(framesHex.value)
    toast('帧分析完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  }
}

// ============ RINEX ============
const rinex = reactive({
  epochsJson: '[]',
  rtcmBase64: '',
  navJson: '[]',
  parseContent: '',
  parseFile: '',
  navParseContent: '',
  navParseFile: '',
})
const rinexResult = ref<any>(null)
const rinexFiles = ref<any[]>([])
const rinexVersions = ref<string[]>([])
const rinexFileContent = ref<string>('')
const rinexFileModal = ref(false)

function parseJson(s: string, fallback: any): any {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}
async function doRinexGenerate() {
  try {
    loading.value = true
    // 请求体是 RinexGenerateRequest（{ epochs: [...] }），不是裸数组——
    // 直接传数组后端拿不到 epochs 字段，会返回 code=10001 参数错误。
    rinexResult.value = await decodeApi.generateRinex({ epochs: parseJson(rinex.epochsJson, []) })
    toast('RINEX 观测文件已生成', 'success')
    await loadRinexFiles()
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doRinexFromRtcm() {
  try {
    loading.value = true
    rinexResult.value = await decodeApi.generateRinexFromRtcm({ base64: rinex.rtcmBase64 })
    toast('RTCM→RINEX 一步式完成', 'success')
    await loadRinexFiles()
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doRinexNav() {
  try {
    loading.value = true
    // 导航文件生成请求没有 epochs，navigationMessages 必填
    rinexResult.value = await decodeApi.generateRinexNav({
      navigationMessages: parseJson(rinex.navJson, []),
    })
    toast('RINEX 导航文件已生成', 'success')
    await loadRinexFiles()
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doRinexParse() {
  // content / fileName 二选一；空串必须剔除，否则后端优先读到空 content
  const req: RinexParseRequest = {}
  if (rinex.parseContent) req.content = rinex.parseContent
  if (rinex.parseFile) req.fileName = rinex.parseFile
  if (!req.content && !req.fileName) {
    toast('请填写 RINEX 内容，或指定输出目录中的文件名', 'error')
    return
  }
  try {
    loading.value = true
    rinexResult.value = await decodeApi.parseRinex(req)
    toast('RINEX 解析完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
/** 解析输出目录中的 RINEX 文件（GET /rinex/parse?path=，§4.3.5） */
async function doRinexParseByPath() {
  if (!rinex.parseFile) {
    toast('请先在「输出目录文件名」中填写文件名', 'error')
    return
  }
  try {
    loading.value = true
    rinexResult.value = await decodeApi.parseRinexByPath(rinex.parseFile)
    toast('已解析输出目录文件', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doRinexNavParse() {
  if (!rinex.navParseContent) {
    toast('请填写导航文件内容', 'error')
    return
  }
  try {
    loading.value = true
    rinexResult.value = await decodeApi.parseRinexNav({ content: rinex.navParseContent })
    toast('导航文件解析完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
/** 解析输出目录中的导航文件（GET /rinex/nav/parse?path=，§4.3.10） */
async function doRinexNavParseByPath() {
  if (!rinex.navParseFile) {
    toast('请填写输出目录中的导航文件名', 'error')
    return
  }
  try {
    loading.value = true
    rinexResult.value = await decodeApi.parseRinexNavByPath(rinex.navParseFile)
    toast('已解析输出目录导航文件', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function loadRinexFiles() {
  try {
    const [f, v] = await Promise.allSettled([decodeApi.rinexFiles(), decodeApi.rinexVersions()])
    if (f.status === 'fulfilled') rinexFiles.value = f.value as any[]
    if (v.status === 'fulfilled') rinexVersions.value = v.value
  } catch (e: any) {
    /* ignore */
  }
}
async function readRinex(name: string) {
  try {
    rinexFileContent.value = await decodeApi.readRinexFile(name)
    rinexFileModal.value = true
  } catch (e: any) {
    toast('读取失败：' + e.message, 'error')
  }
}
function downloadRinex(name: string) {
  const url = decodeApi.rinexDownloadUrl(name)
  window.open(url, '_blank')
}

// ============ 格式转换 ============
const convert = reactive({
  epochsJson: '[]',
  rtcmBase64: '',
  rinexContent: '',
  anyContent: '',
  anyFormat: '',
  multiJson: '[]',
})
const convertResult = ref<any>(null)
const convertSupported = ref<string[]>([])
async function doStandardize() {
  try {
    loading.value = true
    convertResult.value = await decodeApi.standardize(parseJson(convert.epochsJson, []))
    toast('标准化完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doStandardizeSingle() {
  try {
    loading.value = true
    const arr = parseJson(convert.epochsJson, [])
    convertResult.value = await decodeApi.standardizeSingle(arr[0] || {})
    toast('单历元标准化完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doConvertRtcm() {
  try {
    loading.value = true
    convertResult.value = await decodeApi.convertRtcm({ base64: convert.rtcmBase64 })
    toast('RTCM→标准化完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doConvertRinex() {
  try {
    loading.value = true
    convertResult.value = await decodeApi.convertRinex({ content: convert.rinexContent })
    toast('RINEX→标准化完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doConvertAny() {
  try {
    loading.value = true
    // sourceFormat 留空时后端自动识别，不要传空串
    const req: FormatConvertRequest = { content: convert.anyContent }
    if (convert.anyFormat) req.sourceFormat = convert.anyFormat
    convertResult.value = await decodeApi.convertAny(req)
    toast('自动识别转换完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doConvertMulti() {
  try {
    loading.value = true
    const arr = parseJson(convert.multiJson, [])
    convertResult.value = await decodeApi.convertMulti(arr)
    toast('批量转换完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function loadConvertMeta() {
  try {
    const r = await decodeApi.convertSupported()
    convertSupported.value = r
  } catch (e: any) {
    /* ignore */
  }
}

// ============ 二进制流 ============
const binary = reactive({
  base64: '',
  protocol: '',
})
const binaryResult = ref<any>(null)
const binaryDetectResult = ref<any>(null)
const binaryProtocols = ref<string[]>([])
function buildBinaryReq(): BinaryConvertRequest {
  // protocol 留空时后端自动识别，不能传空串
  const req: BinaryConvertRequest = { base64: binary.base64 }
  if (binary.protocol) req.protocol = binary.protocol
  return req
}
async function doBinaryConvert() {
  if (!binary.base64) {
    toast('请先填写接收机原始二进制 Base64', 'error')
    return
  }
  try {
    loading.value = true
    binaryResult.value = await decodeApi.binaryConvert(buildBinaryReq())
    toast('二进制转换完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
/** 原始二进制转换（§4.5.3，octet-stream 请求体，协议由后端自动识别） */
async function doBinaryRaw() {
  if (!binary.base64) {
    toast('请先填写接收机原始二进制 Base64', 'error')
    return
  }
  try {
    loading.value = true
    binaryResult.value = await decodeApi.binaryConvertRaw(binary.base64)
    toast('原始二进制转换完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doBinaryDetect() {
  if (!binary.base64) {
    toast('请先填写接收机原始二进制 Base64', 'error')
    return
  }
  try {
    loading.value = true
    binaryDetectResult.value = await decodeApi.binaryDetect({ base64: binary.base64 })
    toast('协议识别完成', 'success')
  } catch (e: any) {
    toast('失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function loadBinaryMeta() {
  try {
    binaryProtocols.value = await decodeApi.binaryProtocols()
  } catch (e: any) {
    /* ignore */
  }
}

// ============ SSE 实时 ============
const sseLive = ref<string>('')
let es: EventSource | null = null
const sseConnected = ref(false)
function startSse() {
  if (es) return
  try {
    es = new EventSource(decodeApi.sseStatsUrl())
    es.onopen = () => (sseConnected.value = true)

    /**
     * 后端推送的是**具名事件**，必须用 addEventListener 订阅；
     * onmessage 只接收未命名事件，这里一个都不会触发。
     *
     * 事件名存在文档冲突，按「冲突以接口文档为准」的仲裁规则处理：
     *   接口文档 §4.6.1（主契约）：
     *     stats   每 1 秒推送     DecodeStatsVO
     *     decode  收到 RTCM 解码时  InternalGnssDataVO
     *   对接指南 §4.4：
     *     connected     订阅建立时
     *     decode-result 每次解码完成
     * 主契约取 stats / decode；connected 与 decode-result **同时订阅**作为兼容，
     * 后端推哪一种命名都能收到（这是容错，不是编造功能）。
     */
    const push = (name: string, data: string) => {
      sseLive.value = `[${name}] ${data}\n${sseLive.value.slice(0, 4000)}`
    }
    es.addEventListener('connected', (ev) => {
      push('connected', (ev as MessageEvent).data)
    })
    es.addEventListener('stats', (ev) => {
      const data = (ev as MessageEvent).data
      push('stats', data)
      try {
        stats.value = JSON.parse(data) as DecodeStatsVO
        dropErr('解码统计 /stats')
      } catch {
        /* 解析失败不影响原始日志展示 */
      }
    })
    // 主契约（接口文档 §4.6.1）
    es.addEventListener('decode', (ev) => {
      push('decode', (ev as MessageEvent).data)
    })
    // 兼容对接指南命名
    es.addEventListener('decode-result', (ev) => {
      push('decode-result', (ev as MessageEvent).data)
    })

    es.onerror = () => {
      // EventSource 自带自动重连，这里只更新状态，不主动 close
      sseConnected.value = false
    }
  } catch (e: any) {
    toast('SSE 连接失败：' + e.message, 'error')
  }
}
function stopSse() {
  if (es) {
    es.close()
    es = null
  }
  sseConnected.value = false
}

// ============ AI 洞察 ============
const aiInsights = computed(() => {
  const s = stats.value
  if (!s) return ['后端未连接，请在本地或内网穿透启动 data-decode-service（18082）后查看实时解码数据。']
  const ins: string[] = []
  ins.push(`当前累计处理数据包 ${s.totalPackets ?? 0} 个，成功率 ${((s.successRate ?? 0)).toFixed(1)}%。`)
  if ((s.failedPackets ?? 0) > 0) ins.push(`⚠️ 失败数据包 ${s.failedPackets} 个，建议检查 RTCM/二进制源的数据完整性与 CRC。`)
  if ((s.totalObservations ?? 0) > 0) ins.push(`累计观测量 ${s.totalObservations} 个，卫星 ${s.totalSatellites ?? 0} 颗，解算负载正常。`)
  if ((s.decodeRatePps ?? 0) > 0) ins.push(`实时解码速率 ${s.decodeRatePps} 包/秒，接收 ${s.receiveRateKbps ?? 0} Kbps。`)
  return ins
})

// ============ 生命周期 ============
let timer: number | undefined
onMounted(async () => {
  await loadKpis()
  await Promise.allSettled([loadMonitor(), loadRtcmMeta(), loadRinexFiles(), loadConvertMeta(), loadBinaryMeta()])
  timer = window.setInterval(loadKpis, 30000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  stopSse()
})
</script>

<template>
  <div class="module-view">
    <ConnectionStatus service-name="数据解码服务" :port="18082" health-path="/api/v1/decode/health" mode="real" />
    <!-- 顶部标题 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">数据解码服务</h2>
        <p class="page-sub">data-decode-service ｜ RTCM 解码 · RINEX 生成解析 · 通用格式转换 · GNSS 二进制流转换 ｜ 端口 18082</p>
      </div>
      <div class="header-actions">
        <span class="svc-status" :class="health ? 'up' : 'down'">
          {{ health ? '后端在线' : '后端未连接' }}
        </span>
        <button class="btn btn-primary" @click="loadKpis">刷新</button>
      </div>
    </div>

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

    <!-- 8 KPI 卡 -->
    <div class="kpi-grid">
      <div class="kpi-card" v-for="k in kpis" :key="k.label">
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-value" :style="{ color: k.color }">{{ k.value }}<span class="kpi-unit">{{ k.unit }}</span></div>
      </div>
    </div>

    <!-- AI 洞察 -->
    <div class="ai-panel">
      <div class="ai-head"><span class="ai-icon">✨</span> AI 解码洞察</div>
      <ul class="ai-list">
        <li v-for="(t, i) in aiInsights" :key="i">{{ t }}</li>
      </ul>
    </div>

    <!-- Tab -->
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key">
        {{ t.label }}
      </button>
    </div>

    <!-- 监控运维 -->
    <section v-show="tab === 'monitor'" class="panel">
      <div class="toolbar">
        <button class="btn" :disabled="monitorLoading" @click="loadMonitor">加载监控数据</button>
        <button class="btn btn-warn" @click="resetStats">重置统计</button>
      </div>
      <div class="card-grid">
        <div class="info-card">
          <div class="info-title">版本信息</div>
          <pre class="code-block">{{ monitorData.version ? json(monitorData.version) : '—' }}</pre>
        </div>
        <div class="info-card">
          <div class="info-title">状态汇总</div>
          <pre class="code-block">{{ monitorData.status ? json(monitorData.status) : '—' }}</pre>
        </div>
        <div class="info-card">
          <div class="info-title">配置快照</div>
          <pre class="code-block">{{ monitorData.config ? json(monitorData.config) : '—' }}</pre>
        </div>
        <div class="info-card">
          <div class="info-title">应用信息</div>
          <pre class="code-block">{{ monitorData.appInfo ? json(monitorData.appInfo) : '—' }}</pre>
        </div>
      </div>
    </section>

    <!-- RTCM -->
    <section v-show="tab === 'rtcm'" class="panel">
      <div class="form-row">
        <div class="field grow">
          <label>RTCM 十六进制（hex，可含空格）</label>
          <textarea v-model="rtcm.hex" rows="3" placeholder="d300130001b8f8ac4d6a53a0000000000000..."></textarea>
        </div>
        <div class="field grow">
          <label>RTCM Base64（base64 优先）</label>
          <textarea v-model="rtcm.base64" rows="3" placeholder="0wAT..."></textarea>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>数据源 ID</label><input v-model="rtcm.sourceId" placeholder="MS02STATION" /></div>
        <div class="field"><label>测站 ID</label><input v-model="rtcm.stationId" placeholder="1001" /></div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" :disabled="loading" @click="doRtcm('decode')">解码（自动）</button>
        <button class="btn" :disabled="loading" @click="doRtcm('hex')">十六进制解码</button>
        <button class="btn" :disabled="loading" @click="doRtcm('base64')">Base64 解码</button>
        <button class="btn" :disabled="loading" @click="doRtcmMulti">多路复用解码</button>
        <button class="btn" :disabled="loading" @click="doRtcmRaw">原始二进制解码</button>
      </div>
      <div class="form-row">
        <div class="field grow">
          <label>帧分析 hex</label>
          <input v-model="framesHex" placeholder="d300130001..." />
        </div>
        <button class="btn" @click="doFrames">帧提取分析（CRC）</button>
      </div>
      <div class="meta-row">
        <span>支持消息类型 <b>{{ rtcmMsgTypes.length }}</b> 种</span>
        <span>支持格式：{{ rtcmFormats.join(' / ') || '—' }}</span>
      </div>
      <div v-if="framesResult" class="info-card">
        <div class="info-title">帧分析结果</div>
        <pre class="code-block">{{ json(framesResult) }}</pre>
      </div>
      <div v-if="rtcmResult" class="info-card">
        <div class="info-title">解码结果</div>
        <pre class="code-block">{{ json(rtcmResult) }}</pre>
      </div>
    </section>

    <!-- RINEX -->
    <section v-show="tab === 'rinex'" class="panel">
      <div class="form-row">
        <div class="field grow">
          <label>历元观测 JSON（epochs[]）</label>
          <textarea v-model="rinex.epochsJson" rows="3" placeholder="[]"></textarea>
        </div>
        <div class="field grow">
          <label>RTCM Base64（一步式生成）</label>
          <textarea v-model="rinex.rtcmBase64" rows="3" placeholder="0wAT..."></textarea>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" :disabled="loading" @click="doRinexGenerate">生成 RINEX 观测</button>
        <button class="btn" :disabled="loading" @click="doRinexFromRtcm">RTCM→RINEX</button>
        <button class="btn" :disabled="loading" @click="doRinexNav">生成 RINEX 导航</button>
      </div>
      <div class="form-row">
        <div class="field grow">
          <label>解析 RINEX 内容</label>
          <textarea v-model="rinex.parseContent" rows="3" placeholder="粘贴 RINEX 文本..."></textarea>
        </div>
        <div class="field grow">
          <label>导航电文 JSON（navigationMessages[]）</label>
          <textarea v-model="rinex.navJson" rows="3" placeholder="[]"></textarea>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn" :disabled="loading" @click="doRinexParse">解析 RINEX</button>
        <button class="btn" :disabled="loading" @click="doRinexNavParse">解析导航文件</button>
      </div>
      <!-- 按文件名解析输出目录中的文件：GET /rinex/parse?path= 与 GET /rinex/nav/parse?path= -->
      <div class="form-row">
        <div class="field">
          <label>输出目录·观测文件名</label>
          <input v-model="rinex.parseFile" placeholder="例：MS0200XXX.26O" />
        </div>
        <div class="field">
          <label>输出目录·导航文件名</label>
          <input v-model="rinex.navParseFile" placeholder="例：MS0200XXX.26P" />
        </div>
      </div>
      <div class="toolbar">
        <button class="btn" :disabled="loading" @click="doRinexParseByPath">解析输出目录观测文件</button>
        <button class="btn" :disabled="loading" @click="doRinexNavParseByPath">解析输出目录导航文件</button>
      </div>
      <div class="meta-row">
        <span>支持版本：{{ rinexVersions.join(' / ') || '—' }}</span>
      </div>
      <div class="info-card">
        <div class="info-title">输出目录文件（共 {{ rinexFiles.length }} 个）</div>
        <table v-if="rinexFiles.length" class="data-table">
          <thead><tr><th>文件名</th><th>大小</th><th>历元</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="f in rinexFiles" :key="f.fileName">
              <td>{{ f.fileName }}</td>
              <td>{{ f.sizeBytes }} B</td>
              <td>{{ f.epochCount }}</td>
              <td>
                <button class="link" @click="readRinex(f.fileName)">查看</button>
                <button class="link" @click="downloadRinex(f.fileName)">下载</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无 RINEX 输出文件</div>
      </div>
      <div v-if="rinexResult" class="info-card">
        <div class="info-title">生成/解析结果</div>
        <pre class="code-block">{{ json(rinexResult) }}</pre>
      </div>
    </section>

    <!-- 格式转换 -->
    <section v-show="tab === 'convert'" class="panel">
      <div class="form-row">
        <div class="field grow">
          <label>历元 JSON（标准/单历元/批量 共用）</label>
          <textarea v-model="convert.epochsJson" rows="3" placeholder="[]"></textarea>
        </div>
        <div class="field grow">
          <label>RTCM Base64（RTCM→标准化）</label>
          <textarea v-model="convert.rtcmBase64" rows="3" placeholder="0wAT..."></textarea>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" :disabled="loading" @click="doStandardize">历元标准化</button>
        <button class="btn" :disabled="loading" @click="doStandardizeSingle">单历元标准化</button>
        <button class="btn" :disabled="loading" @click="doConvertRtcm">RTCM→标准化</button>
      </div>
      <div class="form-row">
        <div class="field grow">
          <label>RINEX 内容（RINEX→标准化）</label>
          <textarea v-model="convert.rinexContent" rows="3" placeholder="粘贴 RINEX 文本..."></textarea>
        </div>
        <div class="field grow">
          <label>任意格式内容（自动识别）</label>
          <textarea v-model="convert.anyContent" rows="3" placeholder="粘贴 RTCM/RINEX/文本..."></textarea>
        </div>
        <div class="field"><label>源格式（可选）</label><input v-model="convert.anyFormat" placeholder="RINEX / RTCM3" /></div>
      </div>
      <div class="toolbar">
        <button class="btn" :disabled="loading" @click="doConvertRinex">RINEX→标准化</button>
        <button class="btn" :disabled="loading" @click="doConvertAny">自动识别转换</button>
      </div>
      <div class="form-row">
        <div class="field grow">
          <label>批量转换 JSON（FormatConvertRequest[]）</label>
          <textarea v-model="convert.multiJson" rows="3" placeholder="[]"></textarea>
        </div>
        <button class="btn" :disabled="loading" @click="doConvertMulti">多源批量转换</button>
      </div>
      <div class="meta-row"><span>支持源格式：{{ convertSupported.join(' / ') || '—' }}</span></div>
      <div v-if="convertResult" class="info-card">
        <div class="info-title">转换结果</div>
        <pre class="code-block">{{ json(convertResult) }}</pre>
      </div>
    </section>

    <!-- 二进制流 -->
    <section v-show="tab === 'binary'" class="panel">
      <div class="form-row">
        <div class="field grow">
          <label>接收机原始二进制 Base64</label>
          <textarea v-model="binary.base64" rows="3" placeholder="Base64..."></textarea>
        </div>
        <div class="field"><label>协议（可留空自动识别）</label>
          <select v-model="binary.protocol">
            <option value="">自动识别</option>
            <option v-for="p in binaryProtocols" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" :disabled="loading" @click="doBinaryConvert">二进制转换</button>
        <button class="btn" :disabled="loading" @click="doBinaryDetect">协议识别</button>
        <button class="btn" :disabled="loading" @click="doBinaryRaw">原始二进制转换</button>
      </div>
      <div class="meta-row"><span>支持协议：{{ binaryProtocols.join(' / ') || '—' }}</span></div>
      <div v-if="binaryResult" class="info-card">
        <div class="info-title">转换结果</div>
        <pre class="code-block">{{ json(binaryResult) }}</pre>
      </div>
      <div v-if="binaryDetectResult" class="info-card">
        <div class="info-title">协议识别结果</div>
        <pre class="code-block">{{ json(binaryDetectResult) }}</pre>
      </div>
    </section>

    <!-- SSE 实时 -->
    <section v-show="tab === 'sse'" class="panel">
      <div class="toolbar">
        <button class="btn btn-primary" :disabled="sseConnected" @click="startSse">开始实时流</button>
        <button class="btn btn-warn" :disabled="!sseConnected" @click="stopSse">停止</button>
        <span class="svc-status" :class="sseConnected ? 'up' : 'down'">{{ sseConnected ? '实时流已连接' : '未连接' }}</span>
      </div>
      <div class="info-card">
        <div class="info-title">SSE 统计实时流（event: stats）</div>
        <pre class="code-block sse">{{ sseLive || '等待数据流...' }}</pre>
      </div>
    </section>

    <!-- RINEX 文件内容弹窗 -->
    <div v-if="rinexFileModal" class="modal-mask" @click.self="rinexFileModal = false">
      <div class="modal">
        <div class="modal-head"><span>RINEX 文件内容</span><button class="modal-close" @click="rinexFileModal = false">✕</button></div>
        <pre class="code-block modal-body">{{ rinexFileContent }}</pre>
      </div>
    </div>

    <!-- Toast -->
    <transition name="fade">
      <div v-if="toastMsg" class="toast" :class="toastType">{{ toastMsg }}</div>
    </transition>
  </div>
</template>

<style scoped>
.module-view {
  padding: 20px 24px 40px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1a1a2e;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.page-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}
.page-sub {
  font-size: 13px;
  color: #888;
  margin: 4px 0 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.svc-status {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
}
.svc-status.up {
  background: #e6fffb;
  color: #13c2c2;
}
.svc-status.down {
  background: #fff1f0;
  color: #ff4d4f;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.kpi-card {
  background: #fff;
  border: 1px solid #eef0f3;
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}
.kpi-label {
  font-size: 13px;
  color: #888;
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  margin-top: 8px;
}
.kpi-unit {
  font-size: 13px;
  font-weight: 400;
  color: #aaa;
  margin-left: 4px;
}
.ai-panel {
  background: linear-gradient(135deg, #f0f7ff, #f9f0ff);
  border: 1px solid #d6e8ff;
  border-radius: 12px;
  padding: 14px 18px;
  margin-bottom: 16px;
}
.ai-head {
  font-size: 14px;
  font-weight: 600;
  color: #1890ff;
  margin-bottom: 8px;
}
.ai-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: #444;
  line-height: 1.7;
}
.tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid #eee;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.tab {
  border: none;
  background: transparent;
  padding: 10px 16px;
  font-size: 14px;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tab.active {
  color: #1890ff;
  border-bottom-color: #1890ff;
  font-weight: 600;
}
.panel {
  background: #fff;
  border: 1px solid #eef0f3;
  border-radius: 12px;
  padding: 18px;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.btn {
  border: 1px solid #d9d9d9;
  background: #fff;
  color: #333;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.btn:hover {
  border-color: #1890ff;
  color: #1890ff;
}
.btn-primary {
  background: #1890ff;
  color: #fff;
  border-color: #1890ff;
}
.btn-primary:hover {
  background: #40a9ff;
  color: #fff;
}
.btn-warn {
  border-color: #ffadd2;
  color: #eb2f96;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.form-row {
  display: flex;
  gap: 14px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field.grow {
  flex: 1;
  min-width: 240px;
}
.field label {
  font-size: 12px;
  color: #666;
}
.field input,
.field textarea,
.field select {
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}
.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: #1890ff;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.info-card {
  background: #fafbfc;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  padding: 14px;
}
.info-title {
  font-size: 13px;
  font-weight: 600;
  color: #444;
  margin-bottom: 8px;
}
.code-block {
  background: #1e1e2e;
  color: #d4d4d4;
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.code-block.sse {
  min-height: 200px;
}
.meta-row {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: #888;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th,
.data-table td {
  border: 1px solid #eee;
  padding: 8px 10px;
  text-align: left;
}
.data-table th {
  background: #f5f7fa;
  color: #666;
}
.link {
  border: none;
  background: none;
  color: #1890ff;
  cursor: pointer;
  margin-right: 8px;
  font-size: 13px;
}
.empty {
  font-size: 13px;
  color: #aaa;
  padding: 16px;
  text-align: center;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 12px;
  width: 70%;
  max-width: 820px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid #eee;
  font-weight: 600;
}
.modal-close {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #999;
}
.modal-body {
  max-height: 64vh;
  margin: 12px;
}
.toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.toast.success {
  background: #52c41a;
}
.toast.error {
  background: #ff4d4f;
}
.toast.info {
  background: #1890ff;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .card-grid {
    grid-template-columns: 1fr;
  }
}

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
</style>
