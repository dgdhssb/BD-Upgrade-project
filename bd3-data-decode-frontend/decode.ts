/**
 * data-decode-service API 层（数据解码与格式标准化服务）
 *
 * 服务说明：RTCM 解码 / RINEX 生成解析 / 通用格式转换 / GNSS 二进制流转换 / SSE 实时推送
 * Base URL：http://<host>:18082（本地联调可用内网穿透地址）
 * 真实前缀：/api/v1/{rtcm|rinex|convert|binary|sse|health|stats|status|config|version|app}
 *
 * 注意：本模块的 axios 实例 baseURL 设为 /api/v1/decode（统一前缀），由 vite 代理
 *       通过 rewrite 还原成后端真实 /api/v1/<子域> 前缀，这样只需一条代理即可覆盖
 *       rtcm / rinex / convert / binary / sse / 监控 全部子路径。
 *
 * 接口分组（接口文档 §3 共 **56 组接口**，本模块全部覆盖；约 120+ 实际端点含别名）：
 *   1. 监控运维（12）：health / health.txt / version / version.txt / stats / stats.txt /
 *                     stats.reset / status / status.txt / config / config.txt / app.info
 *   2. RTCM 解码（11）：decode / decode-hex / decode-base64 / decode-raw / decode-multi /
 *                      decode.txt / frames / message-types / message-types.txt / formats / formats.txt
 *   3. RINEX（16）：generate / generate.txt / generate-from-rtcm / nav.generate / nav.generate.txt /
 *                  parse(POST) / parse(GET) / files / files.txt / files.read / nav.parse(POST) /
 *                  nav.parse(GET) / version / version.txt / files.download / download(query)
 *   4. 通用格式转换（8）：standardize / standardize.single / rtcm / rinex / any /
 *                       multi / supported / supported.txt
 *   5. 二进制流（5）：convert / detect / convert-raw / protocols / protocols.txt
 *   6. SSE 实时（2）：sse/stats / sse/subscribers
 *   7. OpenAPI（2）：/v3/api-docs、/swagger-ui/index.html
 *                   （这两个在后端根路径下，走 vite 的 /ms02-docs 代理，不走 /api/v1/decode）
 *
 * 纯真实模式：接口失败直接抛错，无演示数据 fallback
 */
import axios from 'axios'

// ============ 基础实例 ============
const http = axios.create({
  baseURL: '/api/v1/decode',
  timeout: 15000,
})

// 响应拦截器：解包 Result<T>，code !== 0 时抛错
http.interceptors.response.use(
  (resp) => {
    const body = resp.data
    // 非 JSON 响应（SSE 等）原样返回。
    // axios 的 headers 是 AxiosHeaders，取值类型是联合类型，先收窄成 string 再判断。
    const ct = resp.headers?.['content-type']
    if (typeof ct === 'string' && ct.includes('text/event-stream')) {
      return body
    }
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) {
        // 异常响应格式：业务失败 HTTP 200 + code != 0，msg 为后端原始提示。
        // MS-02 错误码：10001 参数错误 / 30001 数据不存在 / 40001 业务异常 / 50000 系统异常
        // （该服务未启用鉴权，故无 20001 未登录 / 20002 无权限）
        throw new Error(`[code=${body.code}] ${body.msg || '业务异常'}`)
      }
      return body.data
    }
    return body
  },
  (err) => {
    if (err.code === 'ECONNABORTED') throw new Error('请求超时（15s）')
    if (err.response) {
      // HTTP 状态码仅表示传输层错误，不是业务失败
      throw new Error(`HTTP ${err.response.status}：${err.response.statusText || '服务异常'}`)
    }
    throw new Error('无法连接后端服务（data-decode-service）')
  },
)

// ============ 类型定义 ============

/** 健康检查 */
export interface HealthVO {
  status?: string
  service?: string
  version?: string
  timestamp?: number
  startedAt?: number
  uptimeSec?: number
  javaVersion?: string
  sseSubscribers?: number
  totalPackets?: number
  failedPackets?: number
  activeSessions?: number
  [key: string]: unknown
}

/** 解码统计 */
export interface DecodeStatsVO {
  timestamp?: number
  totalBytes?: number
  totalPackets?: number
  successPackets?: number
  failedPackets?: number
  totalEpochs?: number
  totalSatellites?: number
  totalObservations?: number
  totalNavigationMessages?: number
  decodeRatePps?: number
  receiveRateKbps?: number
  /** 解码成功率，MS-02 为 0~100 百分比（注意：MS-01 的 DecodeStatVO.successRate 是 0~1，
   *  两个服务单位不同，勿复用同一个格式化函数） */
  successRate?: number
  /** key 为 RTCM 消息号字符串 */
  messageTypeCounts?: Record<string, number>
  activeSessions?: number
  /** 最近 20 条错误 */
  recentErrors?: string[]
  [key: string]: unknown
}

/** RTCM 解码请求 */
export interface RtcmDecodeRequest {
  hex?: string
  base64?: string
  sourceId?: string
  stationId?: string
}

/**
 * 解码/转换统一输出（RTCM 解码 / RINEX 解析 / 二进制转换均返回此结构）
 *
 * ⚠️ 契约仲裁说明（重要，勿随意回退）：
 * 《MS-02 接口文档》§4.2.1 与《MS-01-MS-02 前端对接指南》对同一结构的字段描述**冲突**：
 *   - 接口文档：sourceType / sourceId / epochs / navigationMessages / errors / qualitySummary
 *   - 对接指南：dataId / timestampMs / utcTime / observationsBySystem / qualityCounts / ...
 * 用户已明确裁定：**两份文档冲突时以接口文档为准**。故此处按接口文档实现。
 * 保留索引签名，后端多返回字段时不会报错也不会丢。
 * 若联调时发现后端实际返回的是 observationsBySystem 那套，说明**后端没对齐接口文档**，
 * 应改后端，而不是回头改前端类型。
 */
export interface InternalGnssDataVO {
  /** 数据源类型：RTCM_STREAM / RINEX_FILE / BINARY_STREAM */
  sourceType?: string
  sourceId?: string
  /** 统一历元观测列表 */
  epochs?: GnssEpochObservationVO[]
  navigationMessages?: NavigationMessageVO[]
  /** 标准化错误码列表（ERR_*，见接口文档 §5.3） */
  errors?: string[]
  qualitySummary?: QualitySummaryVO
  [key: string]: unknown
}

/** 质量统计（接口文档 §4.2.1：总观测量 / 卫星数 / 质量等级计数） */
export interface QualitySummaryVO {
  totalObservations?: number
  totalSatellites?: number
  /** 如 { GOOD: 30, MARGINAL: 4, BAD: 2 } */
  qualityCounts?: Record<string, number>
  [key: string]: unknown
}

/** 单颗卫星的观测（epochs[].satellites 的元素，接口文档 §5.2） */
export interface GnssSatObservation {
  /** RINEX 单字符系统码：G / R / E / C / J / I / S */
  system?: string
  prn?: number
  /** 卫星标识，如 G01 / C12 */
  satelliteId?: string
  signals?: SignalObservation[]
  [key: string]: unknown
}

/** 单个信号（频点）的观测量（接口文档 §5.2） */
export interface SignalObservation {
  /** 观测码（RINEX 三字符），如 C1C / L1C / D1C / S1C */
  code?: string
  /** 伪距（m） */
  pseudorange?: number
  /** 载波相位（周） */
  carrierPhase?: number
  /** 多普勒（Hz） */
  doppler?: number
  /** 信噪比（dB-Hz） */
  cnr?: number
  /** 质量等级：GOOD / MARGINAL / BAD */
  quality?: string
  /** 失锁 / 半周标志 */
  flag?: number
  /** 观测错误码 ERR_* */
  errCode?: string
  [key: string]: unknown
}

/** 测站信息 */
export interface StationInfoVO {
  stationName?: string
  markerName?: string
  receiverType?: string
  receiverVersion?: string
  antennaType?: string
  antennaNumber?: string
  approxX?: number
  approxY?: number
  approxZ?: number
  antennaHeight?: number
  coordinateSystem?: string
  countryCode?: string
  source?: string
  intervalSec?: number
  [key: string]: unknown
}

/**
 * RINEX 单字符系统码 → 展示名映射。
 * 接口文档 §5.2：`GnssSatObservation.system` 的取值就是单字符码（G/R/E/C/J/I/S）。
 * 对接指南曾描述为「system 是枚举名、与外层 key 不是同一套」，与接口文档冲突，
 * 按仲裁规则以接口文档为准，故此处只需一套映射。
 */
export const SYS_CODE_TEXT: Record<string, string> = {
  G: 'GPS',
  R: 'GLONASS',
  E: 'Galileo',
  C: 'BDS',
  J: 'QZSS',
  I: 'IRNSS',
  S: 'SBAS',
}

/** RTCM 帧信息 */
export interface RtcmFrameInfo {
  messageNumber?: number
  messageName?: string
  category?: string
  length?: number
  crcValid?: boolean
}

/** RINEX 文件信息 */
export interface RinexFileInfoVO {
  fileName?: string
  /** save=false 时为 "(inline)" */
  filePath?: string
  fileType?: string
  /** 2.11 / 3.04 / 3.05 / 4.00 */
  version?: string
  sizeBytes?: number
  /** ISO-8601 字符串，不是时间戳 */
  startTime?: string
  endTime?: string
  epochCount?: number
  satelliteCount?: number
  observationCount?: number
  intervalSec?: number
  elapsedMs?: number
  success?: boolean
  errorMessage?: string | null
  [key: string]: unknown
}

/** 统一历元观测模型（接口文档 §5.1；RINEX 生成 / 历元标准化 / RTCM 解码结果共用） */
export interface GnssEpochObservationVO {
  /** 历元时间，UTC ISO 字符串（**不是**时间戳，用 new Date(utcTime) 解析） */
  utcTime?: string
  /** 原始系统时间（GPS / BDS / GAL / QZSS 各自的周内秒等） */
  systemTime?: Record<string, unknown>
  receiverTime?: string
  satellites?: GnssSatObservation[]
  stationId?: string
  dataSource?: string
  [key: string]: unknown
}

/**
 * 格式转换请求（接口文档 §4.4.4）
 * 注意：没有 `base64` 字段 —— 二进制流请走 /binary/* 系列接口，不要混用。
 */
export interface FormatConvertRequest {
  sourceFormat?: string
  content?: string
  targetFormat?: string
  sourceId?: string
  stationId?: string
}

/** 二进制转换请求 */
export interface BinaryConvertRequest {
  base64: string
  protocol?: string
  sourceId?: string
  stationId?: string
}

/**
 * 导航电文（接口文档 §5.4）
 * 文档列出：system / prn / messageType / toe / epoch / health / rawData。
 * 下面其余字段是 rawData 内部轨道根数在部分版本后端中的平铺形态，
 * 保留为可选以兼容差异，但不作为主契约依赖。
 */
export interface NavigationMessageVO {
  system?: string
  prn?: number
  satId?: string
  /** 电文类型：1019 / 1020 / 1042 / 1044 / 1045 / 1046 */
  messageType?: string
  /**
   * 星历参考时刻。接口文档 §5.4 描述为对象形态；
   * 部分版本后端把轨道根数平铺到顶层，此时 toe 是数值（周内秒）。
   * 两种形态都可能出现，故用联合类型兼容。
   */
  toe?: number | Record<string, unknown>
  /** 星历历元 */
  epoch?: unknown
  /** 健康状态 */
  health?: number
  /** 原始参数（kepler 轨道根数等） */
  rawData?: Record<string, unknown>
  iode?: number
  gpsWeek?: number
  gpsTow?: number
  af0?: number
  af1?: number
  af2?: number
  sqrtA?: number
  eccentricity?: number
  inclination?: number
  raan?: number
  argPerigee?: number
  meanAnomaly?: number
  raanDot?: number
  inclinationDot?: number
  deltaN?: number
  cuc?: number
  cus?: number
  crc?: number
  crs?: number
  cic?: number
  cis?: number
  toc?: number
  tgd?: number
  frequencyChannel?: number
  dtaun?: number
  age?: number
  svh?: number
  healthy?: boolean
  rawHex?: string
  [key: string]: unknown
}

/** RINEX 生成请求（接口文档 §4.3.1） */
export interface RinexGenerateRequest {
  /** 历元观测列表（必填） */
  epochs: GnssEpochObservationVO[]
  /** 测站信息（缺省用配置） */
  station?: Record<string, unknown>
  /** RINEX 版本（默认 3.04） */
  version?: string
  /** 输出文件名（缺省按命名规范生成） */
  fileName?: string
  /** 是否保存到输出目录（默认 true；false 时 filePath 为 "(inline)"） */
  save?: boolean
}

/**
 * RINEX 导航文件生成请求（接口文档 §4.3.3）
 * 与观测文件生成请求的区别：**没有 epochs，取而代之 navigationMessages 必填**。
 */
export interface RinexNavGenerateRequest {
  navigationMessages: NavigationMessageVO[]
  station?: Record<string, unknown>
  version?: string
  fileName?: string
  save?: boolean
}

/** RINEX 解析请求（接口文档 §4.3.4：content / fileName 二选一） */
export interface RinexParseRequest {
  content?: string
  fileName?: string
  sourceId?: string
}

/** RINEX 解析结果（接口文档 §4.3.4：epochs + navigationMessages） */
export interface DecodeResultVO {
  epochs?: GnssEpochObservationVO[]
  navigationMessages?: NavigationMessageVO[]
  [key: string]: unknown
}

// ============ 请求辅助 ============

/** GET 请求（自动过滤 undefined 参数） */
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

/** POST 表单（query 参数） */
async function postForm<T>(url: string, params: Record<string, unknown>): Promise<T> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v))
  })
  const res = await http.post<T>(`${url}?${q.toString()}`)
  return res as unknown as T
}

/**
 * GET 纯文本接口（响应 text/plain;charset=UTF-8）
 * 纯文本端点返回的是 key=value / 逐行文本，**不是 Result 包装**，
 * 所以必须用 responseType: 'text' 直接取原始字符串，不能走 Result 解包。
 */
async function getText(url: string, params?: Record<string, unknown>): Promise<string> {
  const filtered = params
    ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
    : undefined
  const res = await http.get<string>(url, { params: filtered, responseType: 'text' })
  return res as unknown as string
}

/** POST 纯文本接口（请求 JSON，响应 text/plain） */
async function postText(url: string, data?: unknown): Promise<string> {
  const res = await http.post<string>(url, data, { responseType: 'text' })
  return res as unknown as string
}

/** Base64 → 字节数组（用于 octet-stream 请求体） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(String(b64).replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * POST 原始二进制流（Content-Type: application/octet-stream）
 *
 * 接口文档 §4.2.4 / §4.5.3 明确要求：
 *   - 请求体是**原始字节流**，不是 JSON；
 *   - sourceId / stationId 走 **query 参数**，不是请求体字段。
 * 前端持有的是 Base64 字符串，这里解码成字节再发出去。
 */
async function postRaw<T>(
  url: string,
  base64: string,
  query?: { sourceId?: string; stationId?: string },
): Promise<T> {
  const bytes = b64ToBytes(base64)
  const filtered = query
    ? Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null))
    : {}
  const res = await http.post<T>(url, bytes, {
    headers: { 'Content-Type': 'application/octet-stream' },
    params: filtered,
  })
  return res as unknown as T
}

// ============ API 定义 ============

export const decodeApi = {
  // ============ 1. 监控运维（12 端点，接口文档 §4.1） ============

  /** 健康检查（JSON）· 别名 /health.json */
  health: () => get<HealthVO>('/health'),
  /** 健康检查（纯文本 key=value）· 别名 /health/plain */
  healthText: () => getText('/health.txt'),
  /** 服务版本信息 · 别名 /version.json */
  version: () => get<Record<string, unknown>>('/version'),
  /** 版本信息（纯文本） */
  versionText: () => getText('/version.txt'),
  /** 解码统计快照 · 别名 /stats.json、/decode-stats */
  stats: () => get<DecodeStatsVO>('/stats'),
  /** 解码统计（纯文本）· 别名 /decode-stats.txt */
  statsText: () => getText('/stats.txt'),
  /** 重置解码统计（无请求体） */
  resetStats: () => post<boolean>('/stats/reset'),
  /** 服务状态汇总 · 别名 /status.json */
  status: () => get<Record<string, unknown>>('/status'),
  /** 服务状态汇总（纯文本） */
  statusText: () => getText('/status.txt'),
  /** 配置只读快照 · 别名 /config.json */
  config: () => get<Record<string, unknown>>('/config'),
  /** 配置只读快照（纯文本） */
  configText: () => getText('/config.txt'),
  /** 应用信息 */
  appInfo: () => get<Record<string, unknown>>('/app/info'),

  // ============ 2. RTCM 3.3 解码（11 端点，§4.2） ============

  /** RTCM 解码（hex / base64 二选一，base64 优先）
   *  别名 /rtcm/parse、/rtcm、/decode/decode、/decode/parse、/decode */
  decodeRtcm: (req: RtcmDecodeRequest) => post<InternalGnssDataVO>('/rtcm/decode', req),
  /** 十六进制解码（仅处理 hex） */
  decodeRtcmHex: (req: RtcmDecodeRequest) => post<InternalGnssDataVO>('/rtcm/decode-hex', req),
  /** Base64 解码（仅处理 base64） */
  decodeRtcmBase64: (req: RtcmDecodeRequest) => post<InternalGnssDataVO>('/rtcm/decode-base64', req),
  /** 原始二进制解码（octet-stream 请求体 + query 传 sourceId/stationId，§4.2.4） */
  decodeRtcmRaw: (base64: string, query?: { sourceId?: string; stationId?: string }) =>
    postRaw<InternalGnssDataVO>('/rtcm/decode-raw', base64, query),
  /** 多路复用解码（请求体为数组，逐条解码，跳过空数据） */
  decodeRtcmMulti: (reqs: RtcmDecodeRequest[]) => post<InternalGnssDataVO[]>('/rtcm/decode-multi', reqs),
  /** RTCM 解码结果（纯文本摘要，§4.2.9） */
  decodeRtcmText: (req: RtcmDecodeRequest) => postText('/rtcm/decode.txt', req),
  /** 帧提取分析（含 CRC-24Q 校验，query: hex） */
  rtcmFrames: (hex: string) => get<RtcmFrameInfo[]>('/rtcm/frames', { hex }),
  /** 支持的消息类型列表 · 别名 /rtcm/messages、/rtcm/supported-messages */
  rtcmMessageTypes: () => get<unknown[]>('/rtcm/message-types'),
  /** 消息类型列表（纯文本，每行「消息号\\t枚举名\\t描述」） */
  rtcmMessageTypesText: () => getText('/rtcm/message-types.txt'),
  /** 支持的格式列表 · 别名 /rtcm/supported-formats */
  rtcmFormats: () => get<string[]>('/rtcm/formats'),
  /** 格式列表（纯文本，每行一个） */
  rtcmFormatsText: () => getText('/rtcm/formats.txt'),

  // ============ 3. RINEX（16 端点，§4.3） ============

  /** 历元数据 → RINEX 观测文件 */
  generateRinex: (req: RinexGenerateRequest) => post<RinexFileInfoVO>('/rinex/generate', req),
  /** 观测内容纯文本（不落盘，§4.3.13） */
  generateRinexText: (req: RinexGenerateRequest) => postText('/rinex/generate.txt', req),
  /** RTCM → RINEX 一步式生成（请求体是 RtcmDecodeRequest） */
  generateRinexFromRtcm: (req: RtcmDecodeRequest) => post<RinexFileInfoVO>('/rinex/generate-from-rtcm', req),
  /** RINEX 导航文件生成（navigationMessages 必填） */
  generateRinexNav: (req: RinexNavGenerateRequest) => post<RinexFileInfoVO>('/rinex/nav/generate', req),
  /** 导航内容纯文本（不落盘，§4.3.14） */
  generateRinexNavText: (req: RinexNavGenerateRequest) => postText('/rinex/nav/generate.txt', req),
  /** 解析 RINEX 内容（content / fileName 二选一） */
  parseRinex: (req: RinexParseRequest) => post<DecodeResultVO>('/rinex/parse', req),
  /** 解析输出目录中的 RINEX 文件（query: path；不存在返回 code=30001） */
  parseRinexByPath: (path: string) => get<DecodeResultVO>('/rinex/parse', { path }),
  /** 输出目录文件列表 · 别名 /rinex/output、/rinex/list */
  rinexFiles: () => get<RinexFileInfoVO[]>('/rinex/files'),
  /** 文件列表（纯文本，每行「文件名\\t字节数」，无文件返回 (empty)） */
  rinexFilesText: () => getText('/rinex/files.txt'),
  /** 读取输出文件内容（不存在返回 code=30001） */
  readRinexFile: (name: string) => get<string>(`/rinex/files/${encodeURIComponent(name)}`),
  /** 解析 RINEX 导航内容 */
  parseRinexNav: (req: RinexParseRequest) => post<DecodeResultVO>('/rinex/nav/parse', req),
  /** 解析输出目录中的导航文件（query: path） */
  parseRinexNavByPath: (path: string) => get<DecodeResultVO>('/rinex/nav/parse', { path }),
  /** 支持的 RINEX 版本 */
  rinexVersions: () => get<string[]>('/rinex/version'),
  /** 版本列表（纯文本） */
  rinexVersionsText: () => getText('/rinex/version.txt'),
  /** 文件下载 URL（octet-stream，§4.3.11；用 window.open 或 <a download>） */
  rinexDownloadUrl: (name: string) => `/api/v1/decode/rinex/files/${encodeURIComponent(name)}/download`,
  /** 文件下载·query 别名（§4.3.12，name 或 fileName 二选一） */
  rinexDownloadQueryUrl: (name: string) => `/api/v1/decode/rinex/download?name=${encodeURIComponent(name)}`,

  // ============ 4. 通用格式转换（8 端点，§4.4） ============

  /** 历元标准化（多历元，请求体是数组，SR-9） */
  standardize: (epochs: GnssEpochObservationVO[]) => post<InternalGnssDataVO>('/convert/standardize', epochs),
  /** 单历元标准化（请求体是单个对象） */
  standardizeSingle: (epoch: GnssEpochObservationVO) => post<InternalGnssDataVO>('/convert/standardize/single', epoch),
  /** RTCM → 标准化（无有效历元返回 code=10001） */
  convertRtcm: (req: RtcmDecodeRequest) => post<InternalGnssDataVO>('/convert/rtcm', req),
  /** RINEX → 标准化 */
  convertRinex: (req: FormatConvertRequest) => post<InternalGnssDataVO>('/convert/rinex', req),
  /** 多源格式自动识别转换（含 RINEX → RINEX 解析，否则按 RTCM 尝试） */
  convertAny: (req: FormatConvertRequest) => post<InternalGnssDataVO>('/convert/any', req),
  /** 多源批量转换（SR-9-14）· 别名 /convert/batch、/convert/standard/multi；全部失败返回 code=10001 */
  convertMulti: (reqs: FormatConvertRequest[]) => post<InternalGnssDataVO[]>('/convert/multi', reqs),
  /** 支持的源格式列表 · 别名 /convert/formats */
  convertSupported: () => get<string[]>('/convert/supported'),
  /** 支持格式列表（纯文本） */
  convertSupportedText: () => getText('/convert/supported.txt'),

  // ============ 5. GNSS 二进制流转换（5 端点，§4.5） ============

  /** 二进制流 → 统一观测结构（protocol 缺省自动识别） */
  binaryConvert: (req: BinaryConvertRequest) => post<InternalGnssDataVO>('/binary/convert', req),
  /** 二进制协议识别（响应为 ProtocolType 枚举值字符串） */
  binaryDetect: (req: BinaryConvertRequest) => post<string>('/binary/detect', req),
  /** 原始二进制转换（octet-stream 请求体 + query 传 sourceId/stationId，§4.5.3） */
  binaryConvertRaw: (base64: string, query?: { sourceId?: string; stationId?: string }) =>
    postRaw<InternalGnssDataVO>('/binary/convert-raw', base64, query),
  /** 支持的协议列表 */
  binaryProtocols: () => get<string[]>('/binary/protocols'),
  /** 协议列表（纯文本） */
  binaryProtocolsText: () => getText('/binary/protocols.txt'),

  // ============ 6. SSE 实时推送（2 端点，§4.6） ============

  /** 当前 SSE 订阅者数 */
  sseSubscribers: () => get<number>('/sse/subscribers'),
  /**
   * SSE 统计流地址（前端用 EventSource 直连）· 别名 /sse、/stream/stats、/stream
   *
   * ⚠️ 事件名存在文档冲突：
   *   - 接口文档 §4.6.1：`stats`（每秒 DecodeStatsVO）+ `decode`（解码时 InternalGnssDataVO）
   *   - 对接指南 §4.4：`connected` + `stats` + `decode-result`
   * 按「冲突以接口文档为准」的仲裁规则，主契约取 `stats` / `decode`；
   * 页面对 `decode-result` **也做订阅**作为兼容，后端推哪个都能收到（不是编造功能，是容错）。
   */
  sseStatsUrl: () => '/api/v1/decode/sse/stats',

  // ============ 7. OpenAPI / Swagger（§4.7） ============
  // 这两个端点位于后端**根路径**下（不是 /api/v1 前缀），
  // 由 vite 代理 /ms02-docs → 后端根路径，不能走 /api/v1/decode。

  /** OpenAPI 3 规范 JSON（springdoc 自动生成，全部 56 组接口） */
  openApiUrl: () => '/ms02-docs/v3/api-docs',
  /** Swagger UI 交互式文档（浏览器打开，支持 Try it out） */
  swaggerUrl: () => '/ms02-docs/swagger-ui/index.html',
}


export default decodeApi
