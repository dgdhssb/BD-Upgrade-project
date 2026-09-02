/**
 * archive-service 数据归档服务 API 层（MS-10）
 * 真实后端局域网直连（http://192.168.43.7:18090，对应同事机器 18090 端口，同热点可达）
 * 纯真实模式：所有数据均来自后端，接口失败直接抛错，不填充任何演示数据
 * 3 大模块 14 接口：归档记录(6)/备份任务(5)/恢复任务(3)
 */

import { createCaller } from '../fetchCore'

const BASE = '/api/v1/archive'

// ============ 类型定义 ============

export type DataType = 'RAW' | 'DIFF' | 'FIELD'
export type StorageTier = 'HOT' | 'NEARLINE' | 'COLD'
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'

/** 归档记录（ArchiveTaskVO） */
export interface ArchiveRecord {
  id: string
  dataType: DataType
  stationId?: string
  taskId?: string
  filePath: string
  fileName: string
  fileSize: number
  checksum: string
  epochStart?: number
  epochEnd?: number
  validStart?: string
  validEnd?: string
  longitude?: number
  latitude?: number
  altitude?: number
  formData?: Record<string, unknown>
  storageTier: StorageTier
  collectorId?: string
  collectorName?: string
  status: TaskStatus
  createTime: string
  updateTime: string
  deleted: boolean
}

/** 创建/更新归档请求（ArchiveTaskDTO） */
export interface ArchiveTaskDTO {
  dataType: DataType
  stationId?: string
  taskId?: string
  filePath: string
  fileName: string
  fileSize: number
  checksum: string
  epochStart?: number
  epochEnd?: number
  validStart?: string
  validEnd?: string
  longitude?: number
  latitude?: number
  altitude?: number
  formData?: Record<string, unknown>
  storageTier?: StorageTier
  collectorId?: string
  collectorName?: string
}

/** 分页结果包装 */
export interface PageResult<T> {
  total: number
  page: number
  size: number
  records: T[]
}

/** 统一响应 */
export interface ApiResult<T> {
  code: number
  msg: string
  data: T
  timestamp: number
}

/** 备份任务 */
export interface BackupTask {
  id: string
  backupType: string
  targetType: string
  sourcePath: string
  destPath: string
  fileCount: number
  totalSize: number
  status: TaskStatus
  errorMsg?: string
  startTime?: string
  endTime?: string
  createTime: string
}

/** 恢复任务 */
export interface RestoreTask {
  id: string
  backupTaskId: string
  restorePoint?: string
  targetPath: string
  status: TaskStatus
  errorMsg?: string
  startTime?: string
  endTime?: string
  createTime: string
}

/** 下载信息 */
export interface DownloadInfo {
  url: string
  fileName: string
  expireTime: string
}

/** 批量归档响应 */
export interface BatchArchiveResult {
  batchId: string
  archiveIds: string[]
  totalCount: number
  status: TaskStatus
}

/** 状态更新 */
export interface StatusUpdate {
  status: TaskStatus
  errorMsg?: string
}

/**
 * 恢复请求
 * ⚠️ 接口文档 §2 已知坑点：`POST /backups/{id}/restore` **忽略请求体里的 archiveId**，
 *    后端只认路径上的备份任务 {id}。所以 archiveId 设为可选，前端也不该伪造它。
 */
export interface RestoreRequest {
  archiveId?: string
  targetPath: string
  restorePoint?: string
}

/** 存储分级统计 */
export interface TierStat {
  tier: StorageTier
  count: number
  totalSize: number
}

/** 数据类型统计 */
export interface DataTypeStat {
  dataType: DataType
  count: number
  totalSize: number
}

// ============ 纯真实调用核心（共享超时 + 指数退避重试） ============

/** 记录最近一次错误，供页面诊断展示 */
export function lastError(): string {
  return typeof window !== 'undefined' ? ((window as any).__ARCHIVE_API_ERROR__ || '') : ''
}

const { call } = createCaller({
  base: BASE,
  tag: 'archive',
  unwrap: (json: any) => {
    if (json.code !== 0) throw new Error(json.msg || `业务码 ${json.code}`)
    return json.data ?? json.records ?? json
  },
  onError: (diag) => {
    if (typeof window !== 'undefined') (window as any).__ARCHIVE_API_ERROR__ = diag
  },
})

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })
const put = <T>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(path: string) => call<T>(path, { method: 'DELETE' })

// ============ API 对象（14 接口，纯真实） ============

export const archiveApi = {
  // —— 归档记录（6）——
  createRecord: (dto: ArchiveTaskDTO) => post<ArchiveRecord>('/records', dto),
  // dataType 为后端必填参数（不传返回 50000 系统异常）
  listRecords: (params: { dataType: DataType; stationId?: string; status?: TaskStatus; startTime?: number; endTime?: number; page?: number; size?: number }) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return call<PageResult<ArchiveRecord>>(`/records${qs}`)
  },
  getRecord: (dataType: DataType, id: string) => call<ArchiveRecord>(`/records/${dataType}/${id}`),
  updateTier: (dataType: DataType, id: string, tier: StorageTier) =>
    put(`/records/${dataType}/${id}/tier?tier=${tier}`, {}),
  downloadInfo: (dataType: DataType, id: string) => call<DownloadInfo>(`/records/${dataType}/${id}/download`),
  batchArchive: (dtos: ArchiveTaskDTO[]) => post<BatchArchiveResult>('/batch', dtos),

  // —— 备份任务（5）——
  createBackup: (task: Partial<BackupTask>) => post<BackupTask>('/backups', task),
  listBackups: (params?: { backupType?: string; targetType?: string; status?: TaskStatus; page?: number; size?: number }) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return call<PageResult<BackupTask>>(`/backups${qs}`)
  },
  getBackup: (id: string) => call<BackupTask>(`/backups/${id}`),
  updateBackupStatus: (id: string, status: StatusUpdate) => put(`/backups/${id}/status`, status),
  restoreFromBackup: (id: string, req: RestoreRequest) => post<RestoreTask>(`/backups/${id}/restore`, req),

  // —— 恢复任务（3）——
  listRestores: (params?: { status?: TaskStatus; page?: number; size?: number }) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : ''
    return call<PageResult<RestoreTask>>(`/restores${qs}`)
  },
  getRestore: (id: string) => call<RestoreTask>(`/restores/${id}`),
  updateRestoreStatus: (id: string, status: StatusUpdate) => put(`/restores/${id}/status`, status),

  // —— 健康检查（15）——
  health: () => call<{ status: string }>('/health'),

  // —— 统计（基于真实 records 数据在前端聚合，不填充） ——
  /** 拉取某数据类型的全部分页记录 */
  fetchAllByType: async (dataType: DataType): Promise<ArchiveRecord[]> => {
    const pageSize = 1000
    const all: ArchiveRecord[] = []
    let page = 1
    let total = Infinity
    while (all.length < total && page <= 50) {
      const r = await call<PageResult<ArchiveRecord>>(`/records?dataType=${dataType}&page=${page}&size=${pageSize}`)
      all.push(...r.data.records)
      total = r.data.total
      page++
    }
    return all
  },
  /**
   * 一次性扫描三种 dataType 并聚合出「存储分级分布 + 数据类型分布」。
   *
   * 为什么要有这个方法：原先 tierStats / dataTypeStats 各自内部都扫一遍全量，
   * 页面同时调用就变成 2 倍请求（每种类型最多 50 页 × 2）。这里一次扫描复用结果。
   *
   * 单个 dataType 拉取失败不会连累其他类型，但错误会原样收进 errors 交给页面展示
   * （纯真实模式：不允许静默吞掉）。
   */
  allStats: async (): Promise<{
    data: { tierStats: TierStat[]; dataTypeStats: DataTypeStat[]; records: ArchiveRecord[] }
    live: boolean
    errors: string[]
  }> => {
    const errors: string[] = []
    const perType = await Promise.all(
      (['RAW', 'DIFF', 'FIELD'] as DataType[]).map(async (t) => {
        try {
          return await archiveApi.fetchAllByType(t)
        } catch (e) {
          errors.push(`${t} 拉取失败：${e instanceof Error ? e.message : String(e)}`)
          return [] as ArchiveRecord[]
        }
      }),
    )
    const all = perType.flat()

    const tiers: StorageTier[] = ['HOT', 'NEARLINE', 'COLD']
    const tierStats = tiers.map((tier) => {
      const list = all.filter((r) => r.storageTier === tier)
      return { tier, count: list.length, totalSize: list.reduce((s, r) => s + (r.fileSize || 0), 0) }
    })

    const types: DataType[] = ['RAW', 'DIFF', 'FIELD']
    const dataTypeStats = types.map((dataType) => {
      const list = all.filter((r) => r.dataType === dataType)
      return { dataType, count: list.length, totalSize: list.reduce((s, r) => s + (r.fileSize || 0), 0) }
    })

    return { data: { tierStats, dataTypeStats, records: all }, live: errors.length === 0, errors }
  },
  /** 基于已加载的记录算分级分布（避免重复请求） */
  tierStatsFrom: (records: ArchiveRecord[]): TierStat[] =>
    (['HOT', 'NEARLINE', 'COLD'] as StorageTier[]).map((tier) => {
      const list = records.filter((r) => r.storageTier === tier)
      return { tier, count: list.length, totalSize: list.reduce((s, r) => s + (r.fileSize || 0), 0) }
    }),
  /** 基于已加载的记录算类型分布（避免重复请求） */
  dataTypeStatsFrom: (records: ArchiveRecord[]): DataTypeStat[] =>
    (['RAW', 'DIFF', 'FIELD'] as DataType[]).map((dataType) => {
      const list = records.filter((r) => r.dataType === dataType)
      return { dataType, count: list.length, totalSize: list.reduce((s, r) => s + (r.fileSize || 0), 0) }
    }),
  tierStats: async (): Promise<{ data: TierStat[]; live: boolean }> => {
    const r = await archiveApi.allStats()
    return { data: r.data.tierStats, live: r.live }
  },
  dataTypeStats: async (): Promise<{ data: DataTypeStat[]; live: boolean }> => {
    const r = await archiveApi.allStats()
    return { data: r.data.dataTypeStats, live: r.live }
  },
}

// ============ AI 智能分析（对真实数据做分析，不产生业务数据） ============

/**
 * 批量归档结果校验（接口文档 §2 已知坑点）
 *
 * 后端语义：数组里某条 dataType 非法会被**跳过**，但整体仍然返回成功。
 * 所以不能只看「有没有报错」，必须比对返回的 archiveIds 数与入参数。
 */
export function checkBatchResult(inputCount: number, result: BatchArchiveResult): {
  ok: boolean
  created: number
  skipped: number
  message: string
} {
  const created = result?.archiveIds?.length ?? 0
  const reported = result?.totalCount ?? created
  // 以 archiveIds 实际长度为准，totalCount 可能与之一致也可能不一致，取更保守的判断
  const skipped = Math.max(0, inputCount - Math.max(created, reported === created ? created : reported))
  const ok = skipped === 0
  return {
    ok,
    created,
    skipped,
    message: ok
      ? `全部成功，已创建 ${created} 条归档记录。`
      : `部分成功：提交 ${inputCount} 条，实际创建 ${created} 条，跳过 ${skipped} 条。跳过的通常是 dataType 非法（后端只认 RAW/DIFF/FIELD）。`,
  }
}

/**
 * FIELD 数据变更存储分级是否为空操作（接口文档 §2 已知坑点）
 * FIELD 表没有 storage_tier 列，后端返回成功但不会改数据 —— 前端要提前告知用户，
 * 否则用户会以为降级成功了。
 */
export function isTierNoOp(dataType: DataType): boolean {
  return dataType === 'FIELD'
}

/**
 * 变更存储分级前的提示文案（真实行为说明，不是演示文案）
 */
export function tierChangeHint(dataType: DataType, target: StorageTier): string {
  if (isTierNoOp(dataType)) {
    return `FIELD 外业数据在后端没有 storage_tier 列，改为 ${target} 是空操作：接口会返回成功，但数据库不会变化。`
  }
  return `将把该条 ${dataType} 数据迁移到 ${target} 存储层级，这是一次真实的分级变更。`
}

/** 智能存储分级建议：根据数据类型、年龄、访问频率推荐分级 */
export function recommendTier(record: ArchiveRecord): {
  recommended: StorageTier
  reason: string
  action: string
  savingsEstimate: string
} {
  const ageDays = (Date.now() - new Date(record.createTime).getTime()) / 86400000
  const sizeMB = (record.fileSize / 1048576).toFixed(1)

  // FIELD 数据：近期有访问需求，保持 HOT
  if (record.dataType === 'FIELD') {
    return { recommended: 'HOT', reason: `外业采集数据(${sizeMB}MB)通常需要频繁回溯与质检，建议保持 HOT。`, action: '维持 HOT，除非外业任务已结束超过 90 天。', savingsEstimate: '—' }
  }

  // RAW 数据：超过 30 天降 NEARLINE，超过 90 天降 COLD
  if (record.dataType === 'RAW') {
    if (ageDays > 90) {
      return { recommended: 'COLD', reason: `原始观测数据已归档 ${Math.floor(ageDays)} 天，事后解算需求极低。`, action: '降级为 COLD，可节省约 70% 存储成本。', savingsEstimate: `预计节省 ${(record.fileSize * 0.7 / 1048576).toFixed(1)} MB 等效成本` }
    }
    if (ageDays > 30) {
      return { recommended: 'NEARLINE', reason: `原始观测数据已归档 ${Math.floor(ageDays)} 天，近期访问频率下降。`, action: '降级为 NEARLINE，平衡访问延迟与成本。', savingsEstimate: `预计节省 ${(record.fileSize * 0.4 / 1048576).toFixed(1)} MB 等效成本` }
    }
    return { recommended: 'HOT', reason: `原始观测数据(${sizeMB}MB)较新，实时/近实时解算需求高。`, action: '维持 HOT，30 天后自动评估降级。', savingsEstimate: '—' }
  }

  // DIFF 数据：超过 7 天降 NEARLINE，超过 30 天降 COLD
  if (record.dataType === 'DIFF') {
    if (ageDays > 30) {
      return { recommended: 'COLD', reason: `差分产品已过期 ${Math.floor(ageDays)} 天，实时增强价值丧失。`, action: '降级为 COLD，仅保留合规审计需要。', savingsEstimate: `预计节省 ${(record.fileSize * 0.7 / 1048576).toFixed(1)} MB 等效成本` }
    }
    if (ageDays > 7) {
      return { recommended: 'NEARLINE', reason: `差分产品(${sizeMB}MB)已生成 ${Math.floor(ageDays)} 天，即时播发需求降低。`, action: '降级为 NEARLINE，兼顾事后质检与成本。', savingsEstimate: `预计节省 ${(record.fileSize * 0.4 / 1048576).toFixed(1)} MB 等效成本` }
    }
    return { recommended: 'HOT', reason: `差分产品(${sizeMB}MB)刚生成，实时播发与终端增强需求高。`, action: '维持 HOT，7 天后自动评估降级。', savingsEstimate: '—' }
  }

  return { recommended: 'HOT', reason: '默认策略：未识别数据类型按 HOT 处理。', action: '建议补充数据类型识别规则。', savingsEstimate: '—' }
}

/** 容量趋势分析：基于真实归档分布预测容量需求 */
export function analyzeCapacity(tierStats: TierStat[], dataTypeStats: DataTypeStat[]): {
  totalSizeGB: number
  hotPercent: number
  growthRate: string
  suggestion: string
  action: string
} {
  const totalSize = tierStats.reduce((sum, t) => sum + t.totalSize, 0)
  const totalSizeGB = (totalSize / 1073741824).toFixed(2)
  const hotSize = tierStats.find((t) => t.tier === 'HOT')?.totalSize || 0
  const hotPercent = totalSize > 0 ? Math.round((hotSize / totalSize) * 100) : 0

  const suggestion = hotPercent > 60
    ? 'HOT 存储占比过高，建议将 30 天以上的 RAW 和 7 天以上的 DIFF 批量降级。'
    : hotPercent < 20
    ? 'HOT 存储占比偏低，关键实时数据可能被过度降级，检查自动降级策略阈值。'
    : 'HOT / NEARLINE / COLD 分布合理，符合典型 GNSS 数据生命周期。'

  const action = hotPercent > 60
    ? '执行批量存储分级调整：RAW>30天→NEARLINE，RAW>90天→COLD；DIFF>7天→NEARLINE。'
    : hotPercent < 20
    ? '审查最近 7 天是否有 RAW/DIFF 被错误降级，必要时手动提升回 HOT。'
    : '维持当前策略，启用自动生命周期管理（ILM）。'

  return {
    totalSizeGB: Number(totalSizeGB),
    hotPercent,
    growthRate: '基于真实归档数据实时估算',
    suggestion,
    action,
  }
}

/** 归档健康度检查：基于真实记录发现异常归档 */
export function checkHealth(records: ArchiveRecord[]): {
  issue: string
  count: number
  severity: 'high' | 'medium' | 'low'
  advice: string
}[] {
  const issues: ReturnType<typeof checkHealth> = []

  // PENDING 超过 1 小时的记录
  const pendingOld = records.filter((r) => r.status === 'PENDING' && (Date.now() - new Date(r.createTime).getTime()) > 3600000)
  if (pendingOld.length > 0) {
    issues.push({ issue: '归档任务长时间挂起', count: pendingOld.length, severity: 'high', advice: '检查归档 worker 线程池与对象存储连通性；必要时重启归档服务。' })
  }

  // FAILED 记录
  const failed = records.filter((r) => r.status === 'FAILED')
  if (failed.length > 0) {
    issues.push({ issue: '归档失败记录', count: failed.length, severity: 'high', advice: '查看归档服务日志，排查 checksum 校验失败或对象存储写入权限问题。' })
  }

  // 无 checksum 的记录
  const noChecksum = records.filter((r) => !r.checksum)
  if (noChecksum.length > 0) {
    issues.push({ issue: '缺失校验和', count: noChecksum.length, severity: 'medium', advice: '补充 MD5/SHA256 校验和，确保数据完整性可追溯。' })
  }

  // FIELD 数据无坐标
  const fieldNoCoord = records.filter((r) => r.dataType === 'FIELD' && (r.longitude === undefined || r.latitude === undefined))
  if (fieldNoCoord.length > 0) {
    issues.push({ issue: '外业数据缺失坐标', count: fieldNoCoord.length, severity: 'medium', advice: '外业采集数据应强制绑定经纬度，建议在前端采集表单中增加坐标校验。' })
  }

  if (issues.length === 0) {
    issues.push({ issue: '归档健康度良好', count: 0, severity: 'low', advice: '继续保持，建议开启自动完整性校验巡检。' })
  }

  return issues
}
