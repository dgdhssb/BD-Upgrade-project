<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'

interface RouteRow {
  id: string
  predicate: string
  service: string
  port: number
  testUrl: string
  status: 'unknown' | 'online' | 'auth' | 'offline'
  latency: number
  note: string
}

// 路由表（来自接口文档 §7.1，本地 profile 直连端口）
const routes = ref<RouteRow[]>([
  { id: 'auth-service', predicate: '/auth/**', service: 'auth', port: 18093, testUrl: '/auth/verify', status: 'unknown', latency: 0, note: '白名单 /auth/login /auth/register 免登录' },
  { id: 'archive-service', predicate: '/api/v1/archive/**', service: 'archive', port: 18090, testUrl: '/api/v1/archive/health', status: 'unknown', latency: 0, note: '归档记录/备份/恢复' },
  { id: 'lifecycle-service', predicate: '/api/v1/lifecycle/**', service: 'lifecycle', port: 18091, testUrl: '/api/v1/lifecycle/policies', status: 'unknown', latency: 0, note: '策略/迁移/清理/存储' },
  { id: 'metadata-service', predicate: '/api/v1/metadata/**', service: 'metadata', port: 18092, testUrl: '/api/v1/metadata/statistics', status: 'unknown', latency: 0, note: '元信息入库/检索/同步' },
  { id: 'monitor-service', predicate: '/api/v1/monitor/**', service: 'monitor', port: 18094, testUrl: '/api/v1/sysmon/dashboard/health', status: 'unknown', latency: 0, note: '告警规则/记录/QoS/快照' },
  { id: 'monitor-qos', predicate: '/api/v1/qos/**', service: 'monitor', port: 18094, testUrl: '/api/v1/sysmon/dashboard/qos', status: 'unknown', latency: 0, note: 'QoS 入仓' },
  { id: 'monitor-alerts', predicate: '/api/v1/alerts/**', service: 'monitor', port: 18094, testUrl: '/api/v1/sysmon/alerts/ingest', status: 'unknown', latency: 0, note: '告警入仓' },
  { id: 'monitor-snapshots', predicate: '/api/v1/snapshots/**', service: 'monitor', port: 18094, testUrl: '/api/v1/sysmon/snapshots/ingest', status: 'unknown', latency: 0, note: '快照入仓' },
  { id: 'monitor-dashboard', predicate: '/api/v1/dashboard/**', service: 'monitor', port: 18094, testUrl: '/api/v1/sysmon/dashboard/health', status: 'unknown', latency: 0, note: '看板聚合' },
  { id: 'log-service', predicate: '/api/v1/log/**', service: 'log', port: 18095, testUrl: '/api/v1/log/audit', status: 'unknown', latency: 0, note: '操作审计' },
])

const loading = ref(false)
const diagError = ref('')

async function checkRoute(r: RouteRow) {
  const start = performance.now()
  try {
    const res = await fetch(r.testUrl, { method: 'GET', headers: { 'X-User-Id': 'hmi-admin' }, signal: AbortSignal.timeout(5000) })
    r.latency = Math.round(performance.now() - start)
    // 200/业务可达 = 在线；401/20001 网关鉴权拦截 = 服务可达但需登录；其余视为离线
    if (res.ok || res.status === 502) r.status = res.ok ? 'online' : 'offline'
    else if (res.status === 401 || res.status === 403) r.status = 'auth'
    else r.status = 'offline'
  } catch {
    r.latency = Math.round(performance.now() - start)
    r.status = 'offline'
  }
}

async function checkAll() {
  loading.value = true
  diagError.value = ''
  try { await Promise.all(routes.value.map(checkRoute)) }
  catch (e) { diagError.value = String(e) }
  finally { loading.value = false }
}

const summary = () => {
  const online = routes.value.filter((r) => r.status === 'online' || r.status === 'auth').length
  return `${online}/${routes.value.length} 路由下游可达`
}

let timer: ReturnType<typeof setInterval>
onMounted(() => { checkAll(); timer = setInterval(checkAll, 20000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="module-view">
    <ConnectionStatus service-name="网关路由服务" :port="18080" health-path="/api/v1/archive/health" mode="real" />
    <div class="page-head">
      <h2>📊 网关路由与鉴权 <span class="sub">MS-13 · 18080</span></h2>
      <span class="summary">{{ summary() }}</span>
      <span v-if="diagError" class="diag">⚠ {{ diagError }}</span>
    </div>

    <div class="hint">
      网关基于 Spring Cloud Gateway（WebFlux），<b>无 StripPrefix</b>——完整路径原样转发到下游。
      所有非白名单接口经网关需 <code>Authorization: Bearer &lt;token&gt;</code>。
      下表为本地 profile 直连路由表，每行右侧显示对应下游服务的实时连通性（经 vite 代理探测）。
    </div>

    <div class="toolbar">
      <button class="btn primary" @click="checkAll" :disabled="loading">🔄 重新检测连通性</button>
      <span v-if="loading" class="loading-tip">检测中…</span>
    </div>

    <table class="data-table">
      <thead><tr><th>路由ID</th><th>Path 谓词</th><th>下游服务</th><th>端口</th><th>连通性</th><th>延迟</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="r in routes" :key="r.id">
          <td>{{ r.id }}</td>
          <td><code>{{ r.predicate }}</code></td>
          <td>{{ r.service }}</td>
          <td>:{{ r.port }}</td>
          <td>
            <span class="tag" :class="r.status === 'online' ? 'ok' : r.status === 'auth' ? 'warn' : 'bad'">
              {{ r.status === 'online' ? '在线' : r.status === 'auth' ? '需登录' : r.status === 'offline' ? '离线' : '—' }}
            </span>
          </td>
          <td>{{ r.latency ? r.latency + 'ms' : '—' }}</td>
          <td class="note">{{ r.note }}</td>
        </tr>
      </tbody>
    </table>

    <div class="tips">
      <h4>联调提示</h4>
      <ul>
        <li>网关 <code>jwt.secret</code> 需与 auth 服务签发密钥一致，否则全部 401。</li>
        <li>auth 的 <code>/auth/login</code> / <code>/auth/register</code> 免登录；其余接口需带 Bearer。</li>
        <li>配置前缀瑕疵：当前写在 <code>spring.cloud.gateway.server.webflux.routes</code>（非标准），实测仍生效，联调结束建议改为 <code>spring.cloud.gateway.routes</code>。</li>
        <li>本地 profile 要求 6 个业务服务全部本机运行，缺一不可；生产 <code>lb://</code> 依赖 Nacos。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.module-view { padding: 4px; }
.page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.page-head h2 { font-size: 20px; margin: 0; }
.sub { font-size: 12px; color: #999; font-weight: 400; }
.summary { font-size: 13px; color: #1890ff; background: #e6f7ff; padding: 3px 10px; border-radius: 10px; }
.diag { color: #cf1322; font-size: 13px; }
.hint { font-size: 13px; color: #555; background: #fafafa; border: 1px solid #eef0f3; border-radius: 8px; padding: 12px; margin-bottom: 12px; line-height: 1.7; }
.hint code { background: #fff; padding: 1px 5px; border-radius: 4px; border: 1px solid #eee; }
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.btn { border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.btn.primary { background: #1890ff; color: #fff; border-color: #1890ff; }
.loading-tip { font-size: 13px; color: #1890ff; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; border: 1px solid #eef0f3; border-radius: 10px; overflow: hidden; }
.data-table th, .data-table td { border-bottom: 1px solid #f0f0f0; padding: 10px 12px; text-align: left; }
.data-table th { background: #fafafa; color: #666; font-weight: 600; }
.data-table code { background: #f5f5f5; padding: 1px 5px; border-radius: 4px; }
.note { color: #888; font-size: 12px; }
.tag { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.tag.ok { background: #f6ffed; color: #389e0d; }
.tag.bad { background: #fff2f0; color: #cf1322; }
.tag.warn { background: #fffbe6; color: #d48806; }
.tips { margin-top: 16px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 8px; padding: 12px 16px; font-size: 13px; }
.tips h4 { margin: 0 0 8px; }
.tips ul { margin: 0; padding-left: 18px; line-height: 1.8; }
.tips code { background: #fff; padding: 1px 5px; border-radius: 4px; }
</style>
