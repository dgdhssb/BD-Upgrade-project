/**
 * ntrip-caster-service API 层（NTRIP 播发服务 / Caster 服务端）
 *
 * 服务说明：Netty NIO 监听 TCP 2101，对外提供 NTRIP Caster 播发能力
 *           （多挂载点并行播发 RTCM3、多终端 Basic 认证、SOURCETABLE、模拟数据源、广播注入）
 * Base URL：http://<host>:18088（本地联调可用内网穿透地址）
 * 真实前缀：/api/v1/**（另含 /ntrip/caster/v1/** 别名）
 *
 * 注意：本模块的 axios 实例 baseURL 设为 /api/v1/ntrip-caster（统一虚拟前缀），由 vite 代理
 *       通过 rewrite 还原成后端真实 /api/v1 前缀，这样只需一条代理即可覆盖
 *       health / info / status / events / alerts / mountpoints / clients / stats / sourcetable
 *       / broadcast / simulator 全部主路径，且与 SPA 页面路由 /caster 不冲突。
 *
 * 接口分组（32 组文档接口，约 23 个主 JSON 接口 + SSE + 文本端点）：
 *   1. 监控运维（Monitor）：健康检查 / 服务信息 / 整体状态 / 事件列表 / 告警列表 / SSE 实时事件
 *   2. 挂载点管理（Mountpoint）：列表(分页) / 详情 / 新增 / 删除 / 启用 / 禁用 / 切换
 *   3. 客户端管理（Client）：会话列表(过滤) / 详情 / 踢出
 *   4. 播发统计（Stats）：单挂载点播发统计
 *   5. 数据播发（Broadcast / Simulator）：SOURCETABLE / 注入数据 / 模拟源启停 / 模拟源状态
 *
 * 纯真实模式：接口失败直接抛错，无演示数据 fallback
 */
import axios from 'axios'

// ============ 基础实例 ============
const http = axios.create({
  baseURL: '/api/v1/ntrip-caster',
  timeout: 15000,
})

// 响应拦截器：解包 Result<T>，code !== 0 时抛错；文本/流响应原样返回
http.interceptors.response.use(
  (resp) => {
    const body = resp.data
    const ct = (resp.headers && (resp.headers['content-type'] as string)) || ''
    // SSE / 纯文本响应原样返回
    if (ct.includes('text/event-stream') || ct.includes('text/plain')) {
      return body
    }
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) {
        throw new Error(body.msg || `业务错误 code=${body.code}`)
      }
      return body.data
    }
    return body
  },
  (err) => {
    if (err.code === 'ECONNABORTED') throw new Error('请求超时')
    if (err.response) {
      throw new Error(`HTTP ${err.response.status}：${err.response.statusText || '服务异常'}`)
    }
    throw new Error('无法连接后端服务（18088）')
  },
)

// ============ 类型定义 ============

/** 挂载点统计 DTO（列表项 / 详情 / 单点统计共用） */
export interface MountpointStats {
  name?: string
  enabled?: boolean
  subscriberCount?: number
  hasSource?: boolean
  sentFrames?: number
  sentBytes?: number
  frameRate?: number
  byteRate?: number
  sourceBytes?: number
  authFailures?: number
  format?: string
  system?: string
  sourceDescription?: string
  [key: string]: unknown
}

/** 挂载点新增请求 */
export interface MountpointCreateRequest {
  name: string
  format?: string
  system?: string
  sourceDescription?: string
  authRequired?: boolean
  username?: string
  password?: string
  carrier?: number
  navSystem?: number
  sampleRate?: number
  enabled?: boolean
  [key: string]: unknown
}

/** Caster 整体状态视图 */
export interface CasterStatusView {
  status?: string
  httpPort?: number
  tcpPort?: number
  startTime?: number
  uptimeSeconds?: number
  totalClients?: number
  subscriberCount?: number
  sourceCount?: number
  totalMountpoints?: number
  enabledMountpoints?: number
  totalSentFrames?: number
  totalSentBytes?: number
  frameRate?: number
  byteRate?: number
  mountpoints?: MountpointStats[]
  [key: string]: unknown
}

/** 健康检查 VO */
export interface CasterHealthVO {
  status?: string
  caster?: string
  tcpPort?: number
  httpPort?: number
  mountpoints?: number
  clients?: number
  [key: string]: unknown
}

/** 服务信息 VO */
export interface CasterInfoVO {
  service?: string
  name?: string
  version?: string
  tcpPort?: number
  httpPort?: number
  uptimeSeconds?: number
  [key: string]: unknown
}

/** 事件 VO */
export interface CasterEventVO {
  id?: number
  time?: number
  type?: string
  level?: string
  message?: string
  [key: string]: unknown
}

/** 客户端会话视图 */
export interface ClientView {
  id?: string
  remoteAddress?: string
  mountpoint?: string
  role?: string
  userAgent?: string
  ntripVersion?: string
  username?: string
  connectTime?: number
  durationSeconds?: number
  lastActive?: number
  rxBytes?: number
  txFrames?: number
  txBytes?: number
  active?: boolean
  [key: string]: unknown
}

/** 广播注入请求 */
export interface BroadcastInjectRequest {
  mountpoint: string
  data: string
  encoding?: string
  times?: number
  [key: string]: unknown
}

/** 模拟数据源启动请求 */
export interface SimulatorStartRequest {
  mountpoint: string
  intervalMs?: number
  frameTypes?: string
  [key: string]: unknown
}

/** 分页结果（挂载点列表） */
export interface PageResult<T> {
  content?: T[]
  total?: number
  totalElements?: number
  totalPages?: number
  page?: number
  size?: number
  [key: string]: unknown
}

/** 统一响应（信息 / 状态快照返回 Map） */
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

/** GET 文本响应（SOURCETABLE 等 text/plain 接口） */
async function getText(url: string): Promise<string> {
  const res = await http.get<string>(url, { responseType: 'text' })
  return res as unknown as string
}

// ============ API 定义 ============

export const casterApi = {
  // ============ 1. 监控运维（Monitor） ============

  /** 健康检查（JSON） */
  getHealth: () => get<CasterHealthVO>('/health'),
  /** 服务信息（含 /version 别名） */
  getInfo: () => get<CasterInfoVO>('/info'),
  /** 整体状态 + 全量统计（含 /stats 别名） */
  getStatus: () => get<CasterStatusView>('/status'),
  /** 事件列表 */
  listEvents: (limit = 50) => get<CasterEventVO[]>('/events', { limit }),
  /** 告警列表（仅 WARN/ERROR 级别） */
  listAlerts: (limit = 50) => get<CasterEventVO[]>('/alerts', { limit }),
  /** SSE 实时事件流地址（前端用 EventSource 直连） */
  streamUrl: () => '/api/v1/ntrip-caster/events/stream',

  // ============ 2. 挂载点管理（Mountpoint） ============

  /** 挂载点列表（分页） */
  listMountpoints: (page = 1, size = 100) =>
    get<PageResult<MountpointStats>>('/mountpoints', { page, size }),
  /** 单挂载点详情 */
  getMountpoint: (name: string) => get<MountpointStats>(`/mountpoints/${enc(name)}`),
  /** 新增挂载点 */
  createMountpoint: (dto: MountpointCreateRequest) => post<MountpointStats>('/mountpoints', dto),
  /** 删除挂载点 */
  deleteMountpoint: (name: string) => del<MountpointStats>(`/mountpoints/${enc(name)}`),
  /** 启用挂载点 */
  enableMountpoint: (name: string) => post<MountpointStats>(`/mountpoints/${enc(name)}/enable`),
  /** 禁用挂载点（断开该挂载点全部订阅者） */
  disableMountpoint: (name: string) => post<MountpointStats>(`/mountpoints/${enc(name)}/disable`),
  /** 切换挂载点启停 */
  toggleMountpoint: (name: string) => post<MountpointStats>(`/mountpoints/${enc(name)}/toggle`),

  // ============ 3. 客户端管理（Client） ============

  /** 客户端会话列表（可按挂载点过滤） */
  listClients: (mountpoint?: string) => get<ClientView[]>('/clients', { mountpoint }),
  /** 单客户端会话详情 */
  getClient: (id: string) => get<ClientView>(`/clients/${enc(id)}`),
  /** 踢出客户端 */
  kickClient: (id: string) => post<JsonMap>(`/clients/${enc(id)}/kick`),

  // ============ 4. 播发统计（Stats） ============

  /** 单挂载点播发统计 */
  getMountpointStats: (name: string) => get<MountpointStats>(`/stats/${enc(name)}`),

  // ============ 5. 数据播发（Broadcast / Simulator） ============

  /** SOURCETABLE（完整，含响应头） */
  getSourcetable: () => getText('/sourcetable'),
  /** SOURCETABLE 主体（CAS + STR + ENDSOURCETABLE） */
  getSourcetableBody: () => getText('/sourcetable/body'),
  /** 注入播发数据（hex / base64） */
  injectBroadcast: (dto: BroadcastInjectRequest) => post<JsonMap>('/broadcast/inject', dto),
  /** 启动模拟数据源 */
  startSimulator: (dto: SimulatorStartRequest) => post<JsonMap>('/simulator/start', dto),
  /** 停止模拟数据源 */
  stopSimulator: (name: string) => post<JsonMap>(`/simulator/stop/${enc(name)}`),
  /** 模拟数据源状态（Map<挂载点, 是否运行>） */
  getSimulatorStatus: () => get<JsonMap>('/simulator/status'),
}

export default casterApi
