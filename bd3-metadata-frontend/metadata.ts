/**
 * metadata-service 元数据服务 API 层（MS-12, 端口 18092）
 * 前缀：/api/v1/metadata（+ /sync）
 * 纯真实模式：接口失败直接抛错，不填充演示数据。
 * 共 10 接口：入库(1)/检索(1)/详情(1)/版本(2)/标签(1)/统计(1)/软删(1)/同步(2)
 *
 * 注意：元数据双写 PG + ES；ES 三字段(qualityLevel/isAnomaly/centerPoint) PG 无列，
 * 不同来源 VO 形态不一致，前端需兼容（见接口文档附录 B6）。
 */

import { createCaller } from '../fetchCore'

const BASE = '/api/v1/metadata'

// ============ 类型定义 ============

export type DataType = 'RAW' | 'DIFF' | 'FIELD'

export interface MetadataIngestDTO {
  archiveId: string
  dataType: DataType
  source: string
  stationId: string
  taskId?: string
  coordinateSystem?: string
  resolution?: number
  epochStart?: number
  epochEnd?: number
  boundingBox?: Record<string, unknown>
  fileCount?: number
  totalSize?: number
  tags?: string[]
}

export interface MetadataVO {
  id: string
  archiveId: string
  dataType: DataType
  source: string
  stationId?: string
  taskId?: string
  coordinateSystem: string
  resolution: number
  epochStart: number
  epochEnd: number
  boundingBox?: string
  fileCount: number
  totalSize: number
  tags?: string[]
  createTime: string
  updateTime: string
}

export interface MetadataVersion {
  id: string
  metadataId: string
  version: number
  changeType: 'CREATE' | 'UPDATE' | 'DELETE'
  changeDetail: string
  operator: string
  createTime: string
}

export interface MetadataSearchResult {
  total: number
  records: MetadataVO[]
}

export interface MetadataStatistics {
  totalCount: number
  byDataType: { dataType: DataType; count: number }[]
  esDocCount: number
  pgCount: number
}

export interface SyncState {
  syncTarget: string
  lastSyncId: string | null
  lastSyncTime: string
  pendingCount: number
  status: string
}

export interface PageResult<T> {
  total: number
  page: number
  size: number
  records: T[]
}

export interface ApiResult<T> {
  code: number
  msg: string
  data: T
  timestamp: number
}

/**
 * MS-12 消息契约关键点（前端必须如实告知用户）：
 * - 本服务**不消费任何 MQ topic**（与 archive/lifecycle 之间无 MQ 直接耦合）
 * - 元数据提取由 archive(MS-10) 经 **HTTP** `POST /api/v1/metadata/ingest` 调用触发 —— 不是 MQ
 * - 只出站一条 `bd3.log.audit`，module 固定为 METADATA
 */
export const SEMANTICS = {
  ingest:
    '入库由 archive（MS-10）在归档成功后自动 HTTP 调用 POST /api/v1/metadata/ingest 触发，不经 MQ。' +
    '所以「归档成功但这里查不到元数据」意味着那次 HTTP 调用失败了，不是消息延迟。',
  dualWrite:
    '元信息双写 PG + ES。qualityLevel / isAnomaly / centerPoint 三个字段**只有 ES 有**，PG 无对应列恒为 null。',
  syncTrigger:
    '触发全量同步会**清空 ES 的 qualityLevel / isAnomaly / centerPoint 三字段**，属高危操作，不要随手点。',
  softDelete: '只有软删除，没有物理删除接口。',
} as const

// ============ 真实调用核心（共享超时 + 指数退避重试） ============

export function lastError(): string {
  return typeof window !== 'undefined' ? ((window as any).__METADATA_API_ERROR__ || '') : ''
}

function qs(params?: Record<string, unknown>): string {
  if (!params) return ''
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return s ? `?${s}` : ''
}

const { call } = createCaller({
  base: BASE,
  tag: 'metadata',
  unwrap: (json: any) => {
    // 两套 Result 字段命名：接口文档用 msg，新版对接指南用 message —— 两个都兜（对齐 MS-10/MS-11）。
    if (json.code !== 0) throw new Error(json.msg || json.message || `业务码 ${json.code}`)
    return json.data ?? json
  },
  onError: (diag) => {
    if (typeof window !== 'undefined') (window as any).__METADATA_API_ERROR__ = diag
  },
})

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : { method: 'POST' })
const put = <T>(path: string, body?: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(path: string) => call<T>(path, { method: 'DELETE' })

// ============ API 对象（10 接口，纯真实） ============

export const metadataApi = {
  // 1. 元信息提取入库（PG + ES 双写）
  ingest: (dto: MetadataIngestDTO) => post<MetadataVO>('/ingest', dto),
  // 2. 检索（ES 优先，PG 回退）
  search: (body: { keyword?: string; dataType?: DataType; stationId?: string; page?: number; size?: number; tags?: string[] }) =>
    post<MetadataSearchResult>('/search', body),
  // 3. 详情（仅 PG）
  getDetail: (archiveId: string) => call<MetadataVO>(`/${archiveId}`),
  // 4. 版本详情
  getVersionDetail: (archiveId: string, versionId: string) => call<MetadataVersion>(`/${archiveId}/versions/${versionId}`),
  // 5. 更新标签（PG + ES）
  updateTags: (archiveId: string, tags: string[]) => put<MetadataVO>(`/${archiveId}/tags`, { tags }),
  // 6. 版本历史分页
  listVersions: (archiveId: string, params?: { page?: number; size?: number }) =>
    call<PageResult<MetadataVersion>>(`/${archiveId}/versions${qs(params)}`),
  // 7. 统计概览
  statistics: () => call<MetadataStatistics>('/statistics'),
  // 8. 软删除（PG + ES）
  softDelete: (archiveId: string) => del<{ deleted: boolean }>(`/${archiveId}`),
  // 9. ES 同步状态
  syncState: () => call<SyncState>('/sync/state'),
  // 10. 触发重新全量同步（会清空 ES 三字段，谨慎）
  syncTrigger: () => post<{ triggered: boolean }>('/sync/trigger'),
}

// ============ AI 智能分析 ============

/** 元数据一致性评估：比对 PG 与 ES 文档数 */
export function consistencyCheck(stats: MetadataStatistics): {
  consistent: boolean
  gap: number
  advice: string
} {
  const gap = stats.esDocCount - stats.pgCount
  const consistent = Math.abs(gap) <= stats.pgCount * 0.01 + 1
  return {
    consistent,
    gap,
    advice: consistent
      ? 'PG 与 ES 文档数基本一致，双写健康。'
      : 'ES 与 PG 文档数存在差异，可能 ES 写入失败被静默吞掉，建议比对 esDocCount 与 PG 总数（见附录 B5）。',
  }
}

export default metadataApi
