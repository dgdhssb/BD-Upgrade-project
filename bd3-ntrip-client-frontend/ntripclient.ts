/**
 * ntrip-client-service API 层（实时数据连接管理服务 / NTRIP 客户端）
 *
 * 服务说明：多挂载点 NTRIP 客户端连接管理（连接国家中心/省网 Caster 订阅 RTCM3 数据流）
 * Base URL：http://<host>:18081（本地联调可用内网穿透地址）
 * 真实前缀：/api/v1/**（另含 /api/v1/ntrip/client/** 别名与 .txt 冗余接口）
 *
 * 注意：本模块的 axios 实例 baseURL 设为 /api/v1/ntrip-client（统一虚拟前缀），由 vite 代理
 *       通过 rewrite 还原成后端真实 /api/v1 前缀，这样只需一条代理即可覆盖
 *       mountpoints / connections / status / stats / decode-stats / events / alerts / datasources / health
 *       全部主路径，且与 SPA 页面路由 /ntrip-client 不冲突。
 *
 * 接口分组（约 45 个主 JSON 接口）：
 *   1. 挂载点管理（13）：列表/详情/新增/编辑/删除/启用/禁用/切换/批量新增/批量删除/批量启用/批量禁用/全局 Caster 配置
 *   2. 连接管理（11）：全部连接/汇总/单点/连接/断开/重连/连接全部/断开全部/批量连接/批量断开/批量重连
 *   3. 状态/统计（10）：整体状态/单点状态/批量状态/整体统计/单点统计/速率历史/重置全部/重置单点/解码统计/单点解码统计
 *   4. 事件/告警/数据源（6）：事件/单点事件/告警/单点告警/数据源适配器/ SSE 实时流
 *   5. 向后兼容（4）：兼容连接/断开/重连/配置重载
 *   6. 监控运维（3）：健康检查/版本信息/配置快照
 *
 * 纯真实模式：接口失败直接抛错，无演示数据 fallback
 */
import axios from 'axios'

// ============ 基础实例 ============
const http = axios.create({
  baseURL: '/api/v1/ntrip-client',
  timeout: 15000,
})

// 响应拦截器：解包 Result<T>，code !== 0 时抛错
http.interceptors.response.use(
  (resp) => {
    const body = resp.data
    // 非 JSON 响应（SSE 等）原样返回
    if (resp.headers['content-type'] && resp.headers['content-type'].includes('text/event-stream')) {
      return body
    }
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) {
        // 异常响应格式（接口文档 §2.2）：业务失败一律 HTTP 200 + code != 0，
        // msg 为后端原始提示。这里把 code 一并带上，便于页面错误汇总条定位问题。
        throw new Error(`[code=${body.code}] ${body.msg || '业务异常'}`)
      }
      return body.data
    }
    return body
  },
  (err) => {
    if (err.code === 'ECONNABORTED') throw new Error('请求超时（15s）')
    if (err.response) {
      // HTTP 状态码仅表示传输层错误（接口文档 §2.2 末行），不是业务失败
      throw new Error(`HTTP ${err.response.status}：${err.response.statusText || '服务异常'}`)
    }
    throw new Error('无法连接后端服务（ntrip-client-service）')
  },
)

// ============ 类型定义 ============

/**
 * 挂载点连接状态枚举（后端 NtripMountpointStatus，对接指南 §3.3 / §3.5）
 * 状态色板：CONNECTED 绿 / CONNECTING·AUTHENTICATING 蓝 / RECONNECTING 橙 /
 *          DISCONNECTED 灰 / DISABLED 浅灰 / ERROR 红
 */
export type MountpointStatus =
  | 'DISABLED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR'

/** 挂载点 DTO */
export interface MountpointDTO {
  name?: string
  enabled?: boolean
  format?: string
  satelliteSystems?: string
  authRequired?: boolean
  sourceDescription?: string
  casterHost?: string
  casterPort?: number
  effectiveConnectTimeoutMs?: number
  effectiveIdleTimeoutSec?: number
  effectiveCrcCheck?: boolean
  effectiveDecodeEnabled?: boolean
  ownCasterHost?: string
  ownCasterPort?: number
  connectTimeoutMs?: number
  idleTimeoutSec?: number
  crcCheck?: boolean
  decodeEnabled?: boolean
  username?: string
  status?: MountpointStatus
  statusMessage?: string
  receiveRateKbps?: number
  bytesReceived?: number
  framesReceived?: number
  durationSec?: number
  [key: string]: unknown
}

/** 挂载点新增/编辑请求（注意：编辑用 POST，不是 PUT） */
export interface MountpointRequestDTO {
  name?: string
  enabled?: boolean
  format?: string
  satelliteSystems?: string
  authRequired?: boolean
  username?: string
  password?: string
  sourceDescription?: string
  /** null 回退全局 */
  casterHost?: string | null
  /** <=0 回退全局 */
  casterPort?: number | null
  connectTimeoutMs?: number | null
  idleTimeoutSec?: number | null
  crcCheck?: boolean | null
  decodeEnabled?: boolean | null
}

/** 全局 Caster 配置 */
export interface CasterConfigDTO {
  host?: string
  port?: number
  username?: string
  password?: string
  connectTimeoutMs?: number
  idleTimeoutSec?: number
  crcCheck?: boolean
  decodeEnabled?: boolean
  [key: string]: unknown
}

/** 连接状态 VO */
export interface NtripConnectionStatusVO {
  mountpoint?: string
  status?: string
  statusLabel?: string
  statusMessage?: string
  casterHost?: string
  casterPort?: number
  connectedAt?: number
  durationSec?: number
  lastDataAt?: number
  dataIdleSec?: number
  reconnectAttempts?: number
  [key: string]: unknown
}

/** 连接汇总 VO */
export interface ConnectionsSummaryVO {
  total?: number
  enabled?: number
  connected?: number
  connecting?: number
  reconnecting?: number
  disconnected?: number
  error?: number
  disabled?: number
  totalRateKbps?: number
  totalBytesReceived?: number
  totalFramesReceived?: number
  mountpoints?: MountpointStatsVO[]
  [key: string]: unknown
}

/** 挂载点统计 VO */
export interface MountpointStatsVO {
  mountpoint?: string
  status?: string
  bytesReceived?: number
  framesReceived?: number
  receiveRateKbps?: number
  avgFrameSizeBytes?: number
  durationSec?: number
  dataIdleSec?: number
  [key: string]: unknown
}

/** 整体状态 VO */
export interface NtripStatusVO {
  startedAt?: number
  totalMountpoints?: number
  connectedCount?: number
  connectingCount?: number
  reconnectingCount?: number
  disconnectedCount?: number
  errorCount?: number
  connections?: NtripConnectionStatusVO[]
  [key: string]: unknown
}

/** 整体统计 VO */
export interface NtripStatsVO {
  totalBytesReceived?: number
  totalFramesReceived?: number
  totalReceiveRateKbps?: number
  avgFrameSizeBytes?: number
  mountpoints?: MountpointStatsVO[]
  [key: string]: unknown
}

/** 速率采样 VO */
export interface RateSampleVO {
  time?: number
  rateKbps?: number
  bytesReceived?: number
  framesReceived?: number
  [key: string]: unknown
}

/** 解码统计 VO */
export interface DecodeStatVO {
  mountpoint?: string
  enabled?: boolean
  totalMessages?: number
  decodedMessages?: number
  failedMessages?: number
  /** 解码成功率，MS-01 为 0~1（注意：MS-02 的 DecodeStatsVO.successRate 是 0~100，勿复用格式化函数） */
  successRate?: number
  observationEpochs?: number
  ephemerisMessages?: number
  ssrMessages?: number
  messageTypeCounts?: Record<string, number>
  lastMessageType?: number
  lastDecodeAt?: number
  [key: string]: unknown
}

/** 连接事件 VO */
export interface ConnectionEventVO {
  id?: number
  time?: number
  mountpoint?: string
  eventType?: string
  message?: string
  [key: string]: unknown
}

/** 告警 VO */
export interface AlertVO {
  id?: number
  time?: number
  level?: string
  mountpoint?: string
  message?: string
  [key: string]: unknown
}

/** 数据源适配器 VO */
export interface DataSourceAdapterVO {
  type?: string
  name?: string
  running?: boolean
  runningSince?: number
  description?: string
  [key: string]: unknown
}

/** 健康检查 VO */
export interface HealthVO {
  status?: 'UP' | 'DEGRADED' | 'DOWN'
  service?: string
  version?: string
  timestamp?: number
  startedAt?: number
  uptimeSec?: number
  sseSubscribers?: number
  components?: { name?: string; status?: string; detail?: string }[]
  mountpoints?: { mountpoint?: string; status?: string; connected?: boolean; rateKbps?: number }[]
  [key: string]: unknown
}

/** 版本信息 VO */
export interface VersionVO {
  service?: string
  name?: string
  groupId?: string
  artifactId?: string
  version?: string
  buildTime?: string
  buildTimeMillis?: number
  javaVersion?: string
  startedAt?: number
  uptimeSec?: number
  mountpoints?: number
  [key: string]: unknown
}

/** 统一响应（兼容 config 快照返回 Map） */
export type JsonMap = Record<string, unknown>

// ============ 请求辅助 ============

/** 挂载点名编码（避免特殊字符破坏路径） */
function enc(name: string): string {
  return encodeURIComponent(name)
}

/** GET 请求（自动过滤 undefined/空串 参数） */
async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const filtered = params
    ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
    : undefined
  const res = await http.get<T>(url, { params: filtered })
  return res as unknown as T
}

/** POST 请求 */
async function post<T>(url: string, data?: unknown): Promise<T> {
  const res = await http.post<T>(url, data)
  return res as unknown as T
}

/** DELETE 请求 */
async function del<T>(url: string): Promise<T> {
  const res = await http.delete<T>(url)
  return res as unknown as T
}

// ============ API 定义 ============

export const ntripClientApi = {
  // ============ 1. 挂载点管理（13 接口） ============

  /** 挂载点列表（配置 + 实时状态） */
  listMountpoints: () => get<MountpointDTO[]>('/mountpoints'),
  /** 单挂载点详情 */
  getMountpoint: (name: string) => get<MountpointDTO>(`/mountpoints/${enc(name)}`),
  /** 新增挂载点 */
  createMountpoint: (dto: MountpointRequestDTO) => post<MountpointDTO>('/mountpoints', dto),
  /** 编辑挂载点 */
  updateMountpoint: (name: string, dto: MountpointRequestDTO) => post<MountpointDTO>(`/mountpoints/${enc(name)}`, dto),
  /** 删除挂载点 */
  deleteMountpoint: (name: string) => del<void>(`/mountpoints/${enc(name)}`),
  /** 启用挂载点（自动连接） */
  enableMountpoint: (name: string) => post<MountpointDTO>(`/mountpoints/${enc(name)}/enable`),
  /** 禁用挂载点（自动断开） */
  disableMountpoint: (name: string) => post<MountpointDTO>(`/mountpoints/${enc(name)}/disable`),
  /** 切换挂载点启停 */
  toggleMountpoint: (name: string) => post<MountpointDTO>(`/mountpoints/${enc(name)}/toggle`),
  /** 批量新增/更新 */
  batchMountpoints: (mountpoints: MountpointRequestDTO[]) => post<MountpointDTO[]>('/mountpoints/batch', { mountpoints }),
  /** 批量删除 */
  batchDeleteMountpoints: (mountpoints: string[]) => post<number>('/mountpoints/batch-delete', { mountpoints }),
  /** 批量启用 */
  batchEnableMountpoints: (mountpoints: string[]) => post<number>('/mountpoints/batch-enable', { mountpoints }),
  /** 批量禁用 */
  batchDisableMountpoints: (mountpoints: string[]) => post<number>('/mountpoints/batch-disable', { mountpoints }),
  /** 全局 Caster 连接配置（只读） */
  getCasterConfig: () => get<CasterConfigDTO>('/caster-config'),

  // ============ 2. 连接管理（11 接口） ============

  /** 全部连接实例状态 */
  listConnections: () => get<NtripConnectionStatusVO[]>('/connections'),
  /** 连接汇总（状态计数 + 总速率） */
  getConnectionsSummary: () => get<ConnectionsSummaryVO>('/connections/summary'),
  /** 单挂载点连接状态 */
  getConnection: (name: string) => get<NtripConnectionStatusVO>(`/connections/${enc(name)}`),
  /** 连接指定挂载点 */
  connect: (name: string) => post<void>(`/connections/${enc(name)}/connect`),
  /** 断开指定挂载点 */
  disconnect: (name: string) => post<void>(`/connections/${enc(name)}/disconnect`),
  /** 重连指定挂载点 */
  reconnect: (name: string) => post<void>(`/connections/${enc(name)}/reconnect`),
  /** 连接全部已启用挂载点 */
  connectAll: () => post<void>('/connections/connect-all'),
  /** 断开全部挂载点 */
  disconnectAll: () => post<void>('/connections/disconnect-all'),
  /** 批量连接 */
  batchConnect: (mountpoints: string[]) => post<number>('/connections/batch-connect', { mountpoints }),
  /** 批量断开 */
  batchDisconnect: (mountpoints: string[]) => post<number>('/connections/batch-disconnect', { mountpoints }),
  /** 批量重连 */
  batchReconnect: (mountpoints: string[]) => post<number>('/connections/batch-reconnect', { mountpoints }),

  // ============ 3. 状态 / 统计（10 接口） ============

  /** 整体连接状态汇总 */
  getStatus: () => get<NtripStatusVO>('/status'),
  /** 单挂载点状态 */
  getStatusByMountpoint: (name: string) => get<NtripConnectionStatusVO>(`/status/${enc(name)}`),
  /** 批量状态查询 */
  queryStatus: (mountpoints: string[]) => post<NtripConnectionStatusVO[]>('/status/query', { mountpoints }),
  /** 整体接收统计 */
  getStats: () => get<NtripStatsVO>('/stats'),
  /** 单挂载点接收统计 */
  getStatsByMountpoint: (name: string) => get<NtripStatsVO>(`/stats/${enc(name)}`),
  /** 速率历史（内存采样） */
  getStatsHistory: (mountpoint: string, seconds = 60) => get<RateSampleVO[]>('/stats/history', { mountpoint, seconds }),
  /** 重置全部统计 */
  resetStats: () => post<void>('/stats/reset'),
  /** 重置单点统计 */
  resetStatsByMountpoint: (name: string) => post<void>(`/stats/${enc(name)}/reset`),
  /** 各挂载点解码统计 */
  getDecodeStats: () => get<DecodeStatVO[]>('/decode-stats'),
  /** 单挂载点解码统计 */
  getDecodeStatsByMountpoint: (name: string) => get<DecodeStatVO>(`/decode-stats/${enc(name)}`),

  // ============ 4. 事件 / 告警 / 数据源（6 接口） ============

  /** 最近连接事件 */
  listEvents: (limit = 100) => get<ConnectionEventVO[]>('/events', { limit }),
  /** 指定挂载点连接事件 */
  listEventsByMountpoint: (name: string, limit = 100) => get<ConnectionEventVO[]>(`/events/${enc(name)}`, { limit }),
  /** 最近告警 */
  listAlerts: (limit = 50) => get<AlertVO[]>('/alerts', { limit }),
  /** 指定挂载点告警 */
  listAlertsByMountpoint: (name: string, limit = 50) => get<AlertVO[]>(`/alerts/${enc(name)}`, { limit }),
  /** 数据接入适配器列表 */
  listDatasources: () => get<DataSourceAdapterVO[]>('/datasources'),
  /** SSE 实时事件流地址（前端用 EventSource 直连）
   *  注意：看板统计必须订阅**不带 mountpoint** 的地址——带过滤只投递
   *  connection-event 与 alert，收不到 stats / decode-stats。 */
  streamUrl: () => '/api/v1/ntrip-client/stream',

  // ============ 5. 向后兼容（4 接口） ============

  /** 兼容：连接（body 指定挂载点或全部） */
  legacyConnect: (mountpoint?: string) => post<void>('/ntrip/client/connect', { mountpoint }),
  /** 兼容：断开（body 指定挂载点或全部） */
  legacyDisconnect: (mountpoint?: string) => post<void>('/ntrip/client/disconnect', { mountpoint }),
  /** 兼容：重连（body 指定挂载点或全部） */
  legacyReconnect: (mountpoint?: string) => post<void>('/ntrip/client/reconnect', { mountpoint }),
  /** 兼容：手动触发配置重新加载 */
  reloadConfig: () => post<void>('/ntrip/client/config/reload'),

  // ============ 6. 监控运维（3 接口） ============

  /** 健康检查（JSON） */
  health: () => get<HealthVO>('/health'),
  /** 服务版本信息 */
  version: () => get<VersionVO>('/version'),
  /** 当前生效配置只读快照（密码脱敏） */
  config: () => get<JsonMap>('/config'),
}

export default ntripClientApi
