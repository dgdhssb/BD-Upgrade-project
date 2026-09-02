/**
 * lifecycle-service 数据生命周期服务 API 层（MS-11, 端口 18091）
 * 前缀：/api/v1/lifecycle/{policies,migrations,cleanup,storage}
 * 纯真实模式：接口失败直接抛错，不填充演示数据。
 * 共 19 接口：策略(5)/迁移(5)/清理(6)/存储(3)
 *
 * 注意：迁移/清理创建接口后端使用 @RequestParam（query 参数），非 JSON body。
 * 迁移/清理"只记录状态不真执行"：接口不搬运/删除物理文件（见接口文档附录）。
 */

import { createCaller } from '../fetchCore'

const BASE = '/api/v1/lifecycle'

// ============ 类型定义 ============

export type DataType = 'RAW' | 'DIFF' | 'FIELD'
export type StorageTier = 'HOT' | 'NEARLINE' | 'COLD'

/**
 * 迁移与清理的状态取值互不相通（接口文档「关键语义」），拆成两个子类型防止串用。
 * 迁移：PENDING → PROCESSING → SUCCESS / FAILED（FAILED → retry → PENDING）
 * 清理：PENDING → APPROVED → EXECUTED（旁路 PENDING → REJECTED）
 */
export type MigrationStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'
export type CleanupStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED'
export type TaskStatus = MigrationStatus | CleanupStatus

export interface LifecyclePolicy {
  policyId: string
  policyName: string
  dataType: DataType
  hotDays: number
  nearlineDays: number
  totalDays: number
  hotPath: string
  nearlinePath: string
  coldPath: string
  enabled: boolean
  createdBy: string
}

export interface MigrationTask {
  id: string
  archiveId: string
  sourceTier: StorageTier
  targetTier: StorageTier
  status: MigrationStatus
  retryCount: number
  errorMsg?: string
}

export interface CleanupAudit {
  id: string
  dataType: DataType
  archiveIds: string
  fileCount: number
  operator: string
  reason: string
  approvedBy?: string
  status: CleanupStatus
  executedTime?: string
  totalSize?: number | null
}

export interface StorageResource {
  id: string
  storageType: StorageTier
  mountPoint: string
  capacity: number
  usage: number
  iops: number
  latency: number
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

// ============ 接口语义（联调重点，前端必须如实告知用户，见接口文档 §2「关键语义」） ============

export const SEMANTICS = {
  /** 接口 6/9：迁移只落库 + 回写状态，不搬运任何物理文件 */
  migration:
    '迁移任务只写入数据库并回写状态，不会搬运任何物理文件；真正的数据搬运由外部执行方完成后回调状态接口（PUT /migrations/{id}/status）。',
  /** 接口 16：清理执行只推状态，不删文件（后端注释「留 hook」） */
  cleanupExecute:
    '执行清理只把审计状态推进到 EXECUTED 并记录 executedTime，不会删除任何物理文件。',
  /** 后端是内存仓储，重启即丢 */
  storage: '后端使用内存仓储，服务重启后数据清空，页面上看到的记录均为本次启动后的真实写入。',
} as const

export const STATUS_FLOW = {
  migration: 'PENDING → PROCESSING → SUCCESS / FAILED（FAILED 可重试回 PENDING）',
  cleanup: 'PENDING → APPROVED → EXECUTED（旁路 PENDING → REJECTED）',
} as const

// ============ 真实调用核心（共享超时 + 指数退避重试） ============

export function lastError(): string {
  return typeof window !== 'undefined' ? ((window as any).__LIFECYCLE_API_ERROR__ || '') : ''
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
  tag: 'lifecycle',
  unwrap: (json: any) => {
    // 两套 Result 字段命名：接口文档用 msg，新版对接指南用 message —— 两个都兜。
    if (json.code !== 0) throw new Error(json.msg || json.message || `业务码 ${json.code}`)
    return json.data ?? json
  },
  onError: (diag) => {
    if (typeof window !== 'undefined') (window as any).__LIFECYCLE_API_ERROR__ = diag
  },
})

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : { method: 'POST' })
const put = <T>(path: string, body?: unknown) =>
  call<T>(path, body !== undefined ? { method: 'PUT', body: JSON.stringify(body) } : { method: 'PUT' })
const del = <T>(path: string) => call<T>(path, { method: 'DELETE' })

// ============ API 对象（19 接口，纯真实） ============

export const lifecycleApi = {
  // —— 生命周期策略（5）——
  createPolicy: (dto: Partial<LifecyclePolicy>) => post<LifecyclePolicy>('/policies', dto),
  listPolicies: (params?: { dataType?: DataType; enabled?: boolean; page?: number; size?: number }) =>
    call<PageResult<LifecyclePolicy>>(`/policies${qs(params)}`),
  getPolicy: (policyId: string) => call<LifecyclePolicy>(`/policies/${policyId}`),
  updatePolicy: (policyId: string, dto: Partial<LifecyclePolicy>) => put<LifecyclePolicy>(`/policies/${policyId}`, dto),
  deletePolicy: (policyId: string) => del<{ deleted: boolean }>(`/policies/${policyId}`),

  // —— 迁移任务（5）——
  // 创建迁移使用 @RequestParam（query 参数）：archiveId, sourceTier, targetTier
  createMigration: (params: { archiveId: string; sourceTier: StorageTier; targetTier: StorageTier }) =>
    post<MigrationTask>(`/migrations${qs(params)}`),
  listMigrations: (params?: { status?: MigrationStatus; page?: number; size?: number }) =>
    call<PageResult<MigrationTask>>(`/migrations${qs(params)}`),
  getMigration: (id: string) => call<MigrationTask>(`/migrations/${id}`),
  // 状态回调：文档注明「无状态机校验」，且未标明 status 走 query 还是 body —— 两边都传，后端任选其一都能读到。
  updateMigrationStatus: (id: string, status: MigrationStatus, errorMsg?: string) =>
    put<MigrationTask>(`/migrations/${id}/status${qs({ status, errorMsg })}`, { status, errorMsg }),
  retryMigration: (id: string) => post<MigrationTask>(`/migrations/${id}/retry`),

  // —— 清理审计（6）——
  // 创建清理使用 @RequestParam：dataType, archiveIds(逗号分隔), fileCount, operator, reason
  createCleanup: (params: { dataType: DataType; archiveIds: string; fileCount: number; operator: string; reason: string }) =>
    post<CleanupAudit>(`/cleanup${qs(params)}`),
  listCleanup: (params?: { status?: CleanupStatus; page?: number; size?: number }) =>
    call<PageResult<CleanupAudit>>(`/cleanup${qs(params)}`),
  getCleanup: (id: string) => call<CleanupAudit>(`/cleanup/${id}`),
  // 审批（需 approvedBy）：文档未标明是 @RequestParam 还是 @RequestBody —— query 与 body 同时传，两种写法后端都能取到。
  approveCleanup: (id: string, approvedBy: string) =>
    put<CleanupAudit>(`/cleanup/${id}/approve${qs({ approvedBy })}`, { approvedBy }),
  rejectCleanup: (id: string, reason?: string) => put<CleanupAudit>(`/cleanup/${id}/reject${qs({ reason })}`),
  executeCleanup: (id: string) => put<CleanupAudit>(`/cleanup/${id}/execute`),

  // —— 存储资源（3）——
  reportStorage: (dto: Partial<StorageResource>) => post<StorageResource>('/storage', dto),
  listStorage: () => call<StorageResource[]>('/storage'),
  getStorage: (id: string) => call<StorageResource>(`/storage/${id}`),
}

// ============ AI 智能分析（对真实数据做分析，不产生业务数据） ============

/** 生命周期策略健康度：基于真实策略发现配置异常 */
export function policyHealth(policies: LifecyclePolicy[]): {
  issue: string
  count: number
  severity: 'high' | 'medium' | 'low'
  advice: string
}[] {
  const issues: ReturnType<typeof policyHealth> = []
  const bad = policies.filter((p) => p.hotDays > p.nearlineDays || p.nearlineDays > p.totalDays)
  if (bad.length > 0) {
    issues.push({
      issue: '分级天数配置倒挂',
      count: bad.length,
      severity: 'high',
      advice: 'HOT ≤ NEARLINE ≤ TOTAL 天数必须满足，否则数据无法正确流转到冷层。',
    })
  }
  const disabled = policies.filter((p) => !p.enabled)
  if (disabled.length > 0) {
    issues.push({
      issue: '策略已停用',
      count: disabled.length,
      severity: 'medium',
      advice: '停用的策略不会触发自动迁移，确认是否预期。',
    })
  }
  const noPath = policies.filter((p) => !p.coldPath)
  if (noPath.length > 0) {
    issues.push({
      issue: '冷层路径缺失',
      count: noPath.length,
      severity: 'medium',
      advice: 'COLD 路径为空将无法归档到冷存储，请补全 mountPoint。',
    })
  }
  if (issues.length === 0) {
    issues.push({ issue: '策略配置健康', count: 0, severity: 'low', advice: '生命周期策略配置合理。' })
  }
  return issues
}

/** 存储容量评估：基于真实存储资源预测是否需要扩容 */
export function storageAdvice(resources: StorageResource[]): {
  totalCapacity: number
  totalUsage: number
  usagePercent: number
  suggestion: string
} {
  const totalCapacity = resources.reduce((s, r) => s + (r.capacity || 0), 0)
  const totalUsage = resources.reduce((s, r) => s + (r.usage || 0), 0)
  const usagePercent = totalCapacity > 0 ? Math.round((totalUsage / totalCapacity) * 100) : 0
  const suggestion =
    usagePercent > 85
      ? '存储使用率超过 85%，建议扩容或加速数据降级到 COLD 层。'
      : usagePercent > 60
        ? '存储使用率偏高，关注 HOT 层增长趋势。'
        : '存储余量充足，容量规划合理。'
  return { totalCapacity, totalUsage, usagePercent, suggestion }
}

export default lifecycleApi
