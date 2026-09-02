/**
 * mountpoint-service API 层（挂载点服务 / MS-09）
 *
 * 服务说明：挂载点生命周期管理 / 批量管理 / 权限(账号)管理 / 数据源表(sourcetable) / 监控运维
 * Base URL：http://<host>:18089（本地联调可用 127.0.0.1:18089）
 * 主前缀：/api/v1/mountpoint
 * 兼容别名前缀：/mountpoint/v1（仅 health / mountpoints/all / sourcetable 三个只读别名）
 *
 * 51 个接口分组：
 *   1. 监控运维（10）：health / version / status / events / alerts / ping（及 .txt 变体）
 *   2. 挂载点生命周期（17）：列表 / 创建 / 详情 / 存在性 / 改(PUT/POST/update) / 启停切换 / 删除
 *   3. 批量管理（6）：batch / batch-query / batch-enable / batch-disable / batch-delete
 *   4. 权限管理（9）：挂载点用户 CRUD / verify / enable / disable
 *   5. 列表服务（5）：sourcetable / body / lines / mappings / formats
 *   6. 兼容别名（3）：/mountpoint/v1/* 三个只读别名
 *
 * 纯真实模式：接口失败直接抛错，无演示数据 fallback
 */
import axios from 'axios'

// ============ 基础实例 ============
const http = axios.create({
  baseURL: '/api/v1/mountpoint',
  timeout: 15000,
})

// 兼容别名实例：/mountpoint/v1/*
const httpAlias = axios.create({
  baseURL: '/mountpoint/v1',
  timeout: 15000,
})

// 响应拦截器：解包 Result<T>，code !== 0 时抛错
function unwrap(interceptor: any) {
  interceptor.use(
    (resp: any) => {
      const body = resp.data
      if (body && typeof body === 'object' && 'code' in body) {
        if (body.code !== 0) {
          throw new Error(body.msg || `业务错误 code=${body.code}`)
        }
        return body.data
      }
      return body
    },
    (err: any) => {
      if (err.code === 'ECONNABORTED') throw new Error('请求超时')
      if (err.response) {
        throw new Error(`HTTP ${err.response.status}：${err.response.statusText || '服务异常'}`)
      }
      throw new Error('无法连接后端服务（18089）')
    },
  )
}
unwrap(http.interceptors.response)
unwrap(httpAlias.interceptors.response)

// ============ 类型定义 ============

/** 挂载点 */
export interface Mountpoint {
  name?: string
  format?: string
  system?: string
  sourceDescription?: string
  authRequired?: boolean
  username?: string
  password?: string
  enabled?: boolean
  maxClients?: number
  country?: string
  sampleRate?: number
  carrier?: number
  navSystem?: number
  createTime?: string
  updateTime?: string
  [key: string]: unknown
}

/** 挂载点用户 */
export interface MountpointUser {
  username?: string
  password?: string
  role?: string
  enabled?: boolean
  [key: string]: unknown
}

// ============ 请求辅助 ============

async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const filtered = params
    ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
    : undefined
  const res = await http.get<T>(url, { params: filtered })
  return res as unknown as T
}

async function post<T>(url: string, data?: unknown): Promise<T> {
  const res = await http.post<T>(url, data)
  return res as unknown as T
}

async function put<T>(url: string, data?: unknown): Promise<T> {
  const res = await http.put<T>(url, data)
  return res as unknown as T
}

async function del<T>(url: string): Promise<T> {
  const res = await http.delete<T>(url)
  return res as unknown as T
}

// ============ API 定义 ============

export const mountpointApi = {
  // ============ 1. 监控运维（10 接口） ============

  /** 健康检查 */
  health: () => get<Record<string, unknown>>('/health'),
  /** 健康检查(纯文本) */
  healthTxt: () => get<string>('/health.txt'),
  /** 版本信息 */
  version: () => get<Record<string, unknown>>('/version'),
  /** 版本信息(纯文本) */
  versionTxt: () => get<string>('/version.txt'),
  /** 运行状态 */
  status: () => get<Record<string, unknown>>('/status'),
  /** 运行状态(纯文本) */
  statusTxt: () => get<string>('/status.txt'),
  /** 运行事件列表 */
  listEvents: (limit = 100) => get<Array<Record<string, unknown>>>('/events', { limit }),
  /** 指定挂载点的运行事件 */
  listEventsByMountpoint: (mountpoint: string) => get<Array<Record<string, unknown>>>(`/events/${encodeURIComponent(mountpoint)}`),
  /** 告警列表 */
  listAlerts: () => get<Array<Record<string, unknown>>>('/alerts'),
  /** 探活 */
  ping: () => get<string>('/ping'),

  // ============ 2. 挂载点生命周期（17 接口） ============

  /** 挂载点分页列表 */
  listMountpoints: (page = 1, size = 10) => get<{ total?: number; page?: number; size?: number; records?: Mountpoint[] }>('/mountpoints', { page, size }),
  /** 挂载点全量列表 */
  listAllMountpoints: () => get<Mountpoint[]>('/mountpoints/all'),
  /** 挂载点简易列表 */
  listMountpointsSimple: () => get<Mountpoint[]>('/mountpoints/list'),
  /** 创建挂载点 */
  createMountpoint: (dto: Partial<Mountpoint>) => post<Mountpoint>('/mountpoints', dto),
  /** 查询挂载点详情 */
  getMountpoint: (name: string) => get<Mountpoint>(`/mountpoints/${encodeURIComponent(name)}`),
  /** 判断挂载点是否存在 */
  existsMountpoint: (name: string) => get<boolean>(`/mountpoints/${encodeURIComponent(name)}/exists`),
  /** 更新挂载点（PUT 全量） */
  updateMountpointPut: (name: string, dto: Partial<Mountpoint>) => put<Mountpoint>(`/mountpoints/${encodeURIComponent(name)}`, dto),
  /** 更新挂载点（POST 部分） */
  updateMountpointPost: (name: string, dto: Partial<Mountpoint>) => post<Mountpoint>(`/mountpoints/${encodeURIComponent(name)}`, dto),
  /** 更新挂载点字段（/update） */
  updateMountpointField: (name: string, dto: Partial<Mountpoint>) => post<Mountpoint>(`/mountpoints/${encodeURIComponent(name)}/update`, dto),
  /** 停用挂载点 */
  disableMountpoint: (name: string) => post<unknown>(`/mountpoints/${encodeURIComponent(name)}/disable`),
  /** 启用挂载点 */
  enableMountpoint: (name: string) => post<unknown>(`/mountpoints/${encodeURIComponent(name)}/enable`),
  /** 切换挂载点启停 */
  toggleMountpoint: (name: string) => post<unknown>(`/mountpoints/${encodeURIComponent(name)}/toggle`),
  /** 删除挂载点 */
  deleteMountpoint: (name: string) => del<unknown>(`/mountpoints/${encodeURIComponent(name)}`),

  // ============ 3. 批量管理（6 接口） ============

  /** 批量创建 */
  batchCreate: (list: Partial<Mountpoint>[]) => post<unknown>('/mountpoints/batch', list),
  /** 批量查询 */
  batchQuery: (mountpoints: string[]) => post<Mountpoint[]>('/mountpoints/batch-query', { mountpoints }),
  /** 批量启用 */
  batchEnable: (mountpoints: string[]) => post<unknown>('/mountpoints/batch-enable', { mountpoints }),
  /** 批量停用 */
  batchDisable: (mountpoints: string[]) => post<unknown>('/mountpoints/batch-disable', { mountpoints }),
  /** 批量删除 */
  batchDelete: (mountpoints: string[]) => post<unknown>('/mountpoints/batch-delete', { mountpoints }),

  // ============ 4. 权限管理（9 接口） ============

  /** 挂载点用户列表 */
  listUsers: (mountpoint: string) => get<MountpointUser[]>(`/mountpoints/${encodeURIComponent(mountpoint)}/users`),
  /** 新增挂载点用户 */
  addUser: (mountpoint: string, dto: MountpointUser) => post<MountpointUser>(`/mountpoints/${encodeURIComponent(mountpoint)}/users`, dto),
  /** 修改挂载点用户 */
  updateUser: (mountpoint: string, username: string, dto: MountpointUser) =>
    put<MountpointUser>(`/mountpoints/${encodeURIComponent(mountpoint)}/users/${encodeURIComponent(username)}`, dto),
  /** 校验挂载点用户（POST + query） */
  verifyUser: (mountpoint: string, username: string, password: string) =>
    http
      .post<{ ok?: boolean; msg?: string }>(`/mountpoints/${encodeURIComponent(mountpoint)}/users/verify`, undefined, {
        params: { username, password },
      })
      .then((r) => r as unknown as { ok?: boolean; msg?: string }),
  /** 停用挂载点用户 */
  disableUser: (mountpoint: string, username: string) => post<unknown>(`/mountpoints/${encodeURIComponent(mountpoint)}/users/${encodeURIComponent(username)}/disable`),
  /** 启用挂载点用户 */
  enableUser: (mountpoint: string, username: string) => post<unknown>(`/mountpoints/${encodeURIComponent(mountpoint)}/users/${encodeURIComponent(username)}/enable`),
  /** 删除挂载点用户 */
  deleteUser: (mountpoint: string, username: string) => del<unknown>(`/mountpoints/${encodeURIComponent(mountpoint)}/users/${encodeURIComponent(username)}`),

  // ============ 5. 列表服务 / 数据源表（5 接口） ============

  /** 数据源表 */
  sourcetable: () => get<string>('/sourcetable'),
  /** 数据源表(body) */
  sourcetableBody: () => get<string>('/sourcetable/body'),
  /** 数据源表(行) */
  sourcetableLines: () => get<string>('/sourcetable/lines'),
  /** 数据源表(映射) */
  sourcetableMappings: () => get<Array<Record<string, unknown>>>('/sourcetable/mappings'),
  /** 数据源表(格式) */
  sourcetableFormats: () => get<string[]>('/sourcetable/formats'),

  // ============ 6. 兼容别名 /mountpoint/v1（3 接口） ============

  /** 别名：挂载点全量列表 */
  aliasMountpointsAll: () => get<Mountpoint[]>('/mountpoints/all'),
  /** 别名：数据源表 */
  aliasSourcetable: () => get<string>('/sourcetable'),
  /** 别名：健康检查 */
  aliasHealth: () => get<Record<string, unknown>>('/health'),
}

export default mountpointApi
