/**
 * positioning-engine-service API 层（定位解算引擎服务 / 模块 4 + 模块 32）
 *
 * 服务说明：实时定位解算与差分改正产品生成
 *           （单点定位 SPP / 坐标转换 / 北斗三频 / 多系统联合 / RTK 差分 / 解算任务 / 终端定位 NMEA）
 * Base URL：http://<host>:18084（本地联调可用内网穿透地址）
 * 真实前缀：/api/v1/**（另含 /api/v1/ping、/api/v1/app/info 监控别名与 .txt 纯文本冗余）
 *
 * 注意：本模块的 axios 实例 baseURL 设为 /api/v1/positioning（统一虚拟前缀），由 vite 代理
 *       通过 rewrite 还原成后端真实 /api/v1 前缀，这样只需一条代理即可覆盖
 *       health / version / stats / config / status / position / coordinate / bds / multi-gnss
 *       / gnss / rtk / correction / task / terminal 全部主路径，且与 SPA 页面路由 /positioning 不冲突。
 *
 * 接口分组（40 个业务接口 + OpenAPI 2 个，约 30 个主 JSON 接口）：
 *   1. 监控运维（Monitor）：健康检查 / 版本 / 统计 / 引擎配置 / 引擎状态 / 应用信息 / Ping 别名
 *   2. 单点定位（SPP）：简化解算 / 观测解算 / 批量解算 / 解算历史 / 最近解算
 *   3. 坐标转换（Coordinate）：BLH↔ECEF 双向转换 / 支持坐标系
 *   4. 北斗三频（BDS）：三频联合解算 / 状态 / 频点
 *   5. 多系统联合（Multi-GNSS）：联合解算 / 支持系统 / 引擎状态
 *   6. RTK 与差分（RTK）：差分解算 / 状态 / 改正生成 / 改正应用 / 改正类型
 *   7. 解算任务（Task）：创建 / 启动 / 列表 / 详情 / 结果 / 删除
 *   8. 终端定位（Terminal）：终端定位 / NMEA 输出 / 定位解
 *
 * 纯真实模式：接口失败直接抛错，无演示数据 fallback
 */
import axios from 'axios'

// ============ 基础实例 ============
const http = axios.create({
  baseURL: '/api/v1/positioning',
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
    throw new Error('无法连接后端服务（18084）')
  },
)

// ============ 类型定义 ============

/** 健康检查 VO */
export interface PositioningHealthVO {
  status?: string
  service?: string
  version?: string
  time?: string
  [key: string]: unknown
}

/** 版本 VO */
export interface PositioningVersionVO {
  service?: string
  version?: string
  java?: string
  [key: string]: unknown
}

/** 统计 VO */
export interface PositioningStatsVO {
  requestCount?: number
  solveCount?: number
  avgSolveMs?: number
  taskCount?: number
  uptimeSeconds?: number
  [key: string]: unknown
}

/** 应用信息 VO */
export interface PositioningAppInfoVO {
  service?: string
  version?: string
  mode?: string
  [key: string]: unknown
}

/** 卫星观测值 */
export interface SatelliteObs {
  satId: string
  system?: string
  x?: number
  y?: number
  z?: number
  pseudorange?: number
  snr?: number
  elevation?: number
  azimuth?: number
  frequency?: string
  [key: string]: unknown
}

/** SPP 请求 */
export interface SppRequest {
  observations?: SatelliteObs[]
  lat?: number
  lon?: number
  alt?: number
  approxXyz?: number[]
  coordinateSystem?: string
  elevationMask?: number
  [key: string]: unknown
}

/** 坐标转换请求（BLH 或 ECEF 输入） */
export interface CoordinateRequest {
  lat?: number
  lon?: number
  alt?: number
  x?: number
  y?: number
  z?: number
  from?: string
  to?: string
  [key: string]: unknown
}

/** RTK 请求 */
export interface RtkRequest {
  baseXyz?: number[]
  baseLat?: number
  baseLon?: number
  baseAlt?: number
  roverObservations?: SatelliteObs[]
  baseObservations?: SatelliteObs[]
  mode?: string
  [key: string]: unknown
}

/** 改正产品生成请求 */
export interface CorrectionRequest {
  type?: string
  baseXyz?: number[]
  baseLat?: number
  baseLon?: number
  baseAlt?: number
  observations?: SatelliteObs[]
  [key: string]: unknown
}

/** 应用改正请求 */
export interface ApplyCorrectionRequest {
  observations: SatelliteObs[]
  product: Record<string, unknown>
  [key: string]: unknown
}

/** SPP 解算结果 */
export interface SppResult {
  mode?: string
  coordinateSystem?: string
  x?: number
  y?: number
  z?: number
  lat?: number
  lon?: number
  alt?: number
  satelliteCount?: number
  usedSatelliteCount?: number
  dop?: number[]
  rms?: number
  iterations?: number
  converged?: boolean
  elapsedMs?: number
  solutionTime?: string
  usedSatellites?: SatelliteObs[]
  frequencies?: string[]
  systems?: Record<string, number>
  [key: string]: unknown
}

/** 坐标转换结果 */
export interface CoordinateResult {
  x?: number
  y?: number
  z?: number
  lat?: number
  lon?: number
  alt?: number
  from?: string
  to?: string
  direction?: string
  [key: string]: unknown
}

/** RTK 解算结果 */
export interface RtkResult {
  mode?: string
  status?: string
  x?: number
  y?: number
  z?: number
  lat?: number
  lon?: number
  alt?: number
  baselineE?: number
  baselineN?: number
  baselineU?: number
  baselineLength?: number
  satellites?: number
  ambiguityFixed?: number
  rms?: number
  solutionTime?: string
  [key: string]: unknown
}

/** 改正产品 */
export interface CorrectionProduct {
  type?: string
  productFormat?: string
  messageCount?: number
  baseLat?: number
  baseLon?: number
  baseAlt?: number
  corrections?: Record<string, unknown>[]
  generatedTime?: string
  [key: string]: unknown
}

/** 解算任务 */
export interface SolveTask {
  taskId?: string
  name?: string
  mode?: string
  status?: string
  progress?: number
  result?: string
  error?: string
  createTime?: string
  updateTime?: string
  [key: string]: unknown
}

/** 终端定位结果 */
export interface TerminalLocateResult {
  terminalId?: string
  lat?: number
  lon?: number
  alt?: number
  satellites?: number
  fixQuality?: number
  solutionTime?: string
  [key: string]: unknown
}

/** NMEA 输出结果 */
export interface NmeaResult {
  terminalId?: string
  lat?: number
  lon?: number
  alt?: number
  satellites?: number
  fixQuality?: string
  sentences?: string[]
  raw?: string
  time?: string
  [key: string]: unknown
}

/** BDS 状态 */
export interface BdsStatusVO {
  status?: string
  operationalSatellites?: number
  frequencies?: string[]
  [key: string]: unknown
}

/** 多系统状态 */
export interface GnssStatusVO {
  status?: string
  systems?: string[]
  [key: string]: unknown
}

/** RTK 引擎状态 */
export interface RtkStatusVO {
  status?: string
  mode?: string
  baseline?: string
  [key: string]: unknown
}

/** 统一响应（Map 类） */
export type JsonMap = Record<string, unknown>

// ============ 请求辅助 ============

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

/** GET 文本响应（.txt 纯文本接口） */
async function getText(url: string): Promise<string> {
  const res = await http.get<string>(url, { responseType: 'text' })
  return res as unknown as string
}

// ============ API 定义 ============

export const positioningApi = {
  // ============ 1. 监控运维（Monitor） ============

  /** 健康检查（JSON） */
  getHealth: () => get<PositioningHealthVO>('/health'),
  /** 健康检查纯文本 */
  getHealthText: () => getText('/health.txt'),
  /** 版本 */
  getVersion: () => get<PositioningVersionVO>('/version'),
  /** 统计 */
  getStats: () => get<PositioningStatsVO>('/stats'),
  /** 引擎配置（纯文本） */
  getConfigText: () => getText('/config.txt'),
  /** 引擎状态（纯文本） */
  getStatusText: () => getText('/status.txt'),
  /** 应用信息 */
  getAppInfo: () => get<PositioningAppInfoVO>('/app/info'),
  /** Ping 别名 */
  ping: () => get<JsonMap>('/ping'),

  // ============ 2. 单点定位（SPP） ============

  /** 简化解算（自动生成模拟观测，GET） */
  sppSimple: (params: {
    lat: number
    lon: number
    alt?: number
    satellites?: number
    system?: string
    coordinateSystem?: string
  }) => get<SppResult>('/position/spp', params),
  /** 观测解算（POST，冗余 /solve） */
  sppSolve: (dto: SppRequest) => post<SppResult>('/position/spp', dto),
  /** SPP 别名（POST） */
  positionSolve: (dto: SppRequest) => post<SppResult>('/position/solve', dto),
  /** SPP 纯文本结果（GET） */
  sppText: () => getText('/position/spp.txt'),
  /** 批量解算（POST，SppRequest[]） */
  sppBatch: (dto: SppRequest[]) => post<SppResult[]>('/position/batch', dto),
  /** 解算历史（最近 20 次） */
  sppHistory: () => get<SppResult[]>('/position/history'),
  /** 最近解算 */
  sppLatest: () => get<SppResult>('/position/latest'),

  // ============ 3. 坐标转换（Coordinate） ============

  /** 坐标转换（POST / GET 双方法，冗余 /transform） */
  convert: (dto: CoordinateRequest) => post<CoordinateResult>('/coordinate/convert', dto),
  /** 坐标转换（GET） */
  convertGet: (params: CoordinateRequest) => get<CoordinateResult>('/coordinate/convert', params),
  /** 转换别名（POST） */
  transform: (dto: CoordinateRequest) => post<CoordinateResult>('/coordinate/transform', dto),
  /** 支持坐标系列表 */
  coordinateSystems: () => get<string[]>('/coordinate/systems'),

  // ============ 4. 北斗三频（BDS） ============

  /** 三频联合解算（POST） */
  bdsSolve: (dto: SppRequest) => post<SppResult>('/bds/solve', dto),
  /** BDS 状态 */
  bdsStatus: () => get<BdsStatusVO>('/bds/status'),
  /** 三频频点 */
  bdsFrequencies: () => get<string[]>('/bds/frequencies'),

  // ============ 5. 多系统联合（Multi-GNSS） ============

  /** 多系统联合解算（POST，冗余 /gnss/solve /multignss/solve /multi-system/solve） */
  multiGnssSolve: (dto: SppRequest) => post<SppResult>('/multi-gnss/solve', dto),
  /** 支持卫星系统 */
  gnssSystems: () => get<string[]>('/gnss/systems'),
  /** 引擎状态 */
  gnssStatus: () => get<GnssStatusVO>('/gnss/status'),

  // ============ 6. RTK 与差分（RTK） ============

  /** RTK 差分解算（POST） */
  rtkSolve: (dto: RtkRequest) => post<RtkResult>('/rtk/solve', dto),
  /** RTK 引擎状态 */
  rtkStatus: () => get<RtkStatusVO>('/rtk/status'),
  /** 差分改正产品生成（POST） */
  correctionGenerate: (dto: CorrectionRequest) => post<CorrectionProduct>('/correction/generate', dto),
  /** 差分改正应用（POST） */
  correctionApply: (dto: ApplyCorrectionRequest) => post<SatelliteObs[]>('/correction/apply', dto),
  /** 改正类型 */
  correctionTypes: () => get<string[]>('/correction/types'),

  // ============ 7. 解算任务（Task） ============

  /** 创建任务（query：name 必填，mode 默认 SPP） */
  createTask: (name: string, mode = 'SPP') =>
    http.post<SolveTask>('/task/create', undefined, { params: { name, mode } }).then((r) => r.data as SolveTask),
  /** 启动任务（query：id） */
  startTask: (taskId: string) =>
    http.post<SolveTask>('/task/start', undefined, { params: { id: taskId } }).then((r) => r.data as SolveTask),
  /** 任务列表 */
  listTasks: () => get<SolveTask[]>('/task/list'),
  /** 任务详情 */
  getTask: (taskId: string) => get<SolveTask>(`/task/${taskId}`),
  /** 任务结果 */
  getTaskResult: (taskId: string) => get<{ result?: string }>(`/task/${taskId}/result`),
  /** 删除任务 */
  deleteTask: (taskId: string) => del<SolveTask>(`/task/${taskId}`),

  // ============ 8. 终端定位（Terminal） ============

  /** 终端定位（GET，query：lat/lon 必填） */
  terminalLocate: (params: { lat: number; lon: number; alt?: number; terminalId?: string; system?: string }) =>
    get<TerminalLocateResult>('/terminal/locate', params),
  /** NMEA 输出（GET） */
  terminalNmea: () => get<NmeaResult>('/terminal/nmea'),
  /** NMEA 纯文本（GET） */
  terminalNmeaText: () => getText('/terminal/nmea.txt'),
  /** 终端定位解（GET） */
  terminalSolution: () => get<TerminalLocateResult>('/terminal/solution'),
}

export default positioningApi
