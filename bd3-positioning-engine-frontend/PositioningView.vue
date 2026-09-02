<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { positioningApi, type SolveTask, type SppResult, type NmeaResult } from '@/api/modules/positioning'

import ConnectionStatus from '@/components/ConnectionStatus.vue'

// ============ 工具 ============
function fmt(v: unknown, d = 2): string {
  if (v === undefined || v === null || v === '') return '-'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(d) : String(v)
  return String(v)
}
function fmtInt(v: unknown): string {
  if (v === undefined || v === null || v === '') return '-'
  return String(v)
}
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const t = document.createElement('div')
  t.textContent = msg
  t.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:8px;font-size:14px;color:#fff;background:${type === 'success' ? '#52c41a' : '#ff4d4f'};box-shadow:0 4px 16px rgba(0,0,0,.18)`
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2600)
}

// ============ 状态 ============
const activeTab = ref('monitor')
const loading = ref(false)
const health = ref<Record<string, unknown> | null>(null)
const stats = ref<Record<string, unknown> | null>(null)
const version = ref<Record<string, unknown> | null>(null)
const appInfo = ref<Record<string, unknown> | null>(null)

// 解算结果展示
const sppResult = ref<SppResult | null>(null)
const bdsResult = ref<SppResult | null>(null)
const multiResult = ref<SppResult | null>(null)
const rtkResult = ref<Record<string, unknown> | null>(null)
const coordResult = ref<Record<string, unknown> | null>(null)
const correctionProduct = ref<Record<string, unknown> | null>(null)
const applyResult = ref<unknown>(null)
const terminalResult = ref<Record<string, unknown> | null>(null)
const nmeaResult = ref<NmeaResult | null>(null)

// 任务列表
const tasks = ref<SolveTask[]>([])
const taskDetail = ref<SolveTask | null>(null)
const taskResultText = ref('')

// 坐标系统 / 卫星系统 / 频点
const coordSystems = ref<string[]>([])
const gnssSystems = ref<string[]>([])
const bdsFreqs = ref<string[]>([])
const correctionTypes = ref<string[]>([])
const bdsStatus = ref<Record<string, unknown> | null>(null)
const gnssStatus = ref<Record<string, unknown> | null>(null)
const rtkStatus = ref<Record<string, unknown> | null>(null)

// 表单
const sppForm = reactive({ lat: 39.9042, lon: 116.4074, alt: 50, satellites: 12, system: 'GPS', cs: 'CGCS2000' })
const coordForm = reactive({ lat: 39.9042, lon: 116.4074, alt: 50, from: 'WGS84', to: 'CGCS2000' })
const rtkForm = reactive({ baseLat: 39.9042, baseLon: 116.4074, baseAlt: 50 })
const termForm = reactive({ lat: 31.2304, lon: 121.4737, alt: 10, terminalId: 'TERM-0001', system: 'GPS' })
const taskForm = reactive({ name: 'RTK测试', mode: 'SPP' })

// ============ 轮询 ============
let timer: number | undefined
async function loadMonitor() {
  try {
    const [h, s, v, a] = await Promise.all([
      positioningApi.getHealth(),
      positioningApi.getStats(),
      positioningApi.getVersion(),
      positioningApi.getAppInfo(),
    ])
    health.value = h as Record<string, unknown>
    stats.value = s as Record<string, unknown>
    version.value = v as Record<string, unknown>
    appInfo.value = a as Record<string, unknown>
  } catch (e: any) {
    health.value = null
    stats.value = null
  }
}
async function loadTasks() {
  try {
    tasks.value = await positioningApi.listTasks()
  } catch {
    tasks.value = []
  }
}
async function loadRefs() {
  try {
    coordSystems.value = await positioningApi.coordinateSystems()
  } catch {
    coordSystems.value = []
  }
  try {
    gnssSystems.value = await positioningApi.gnssSystems()
  } catch {
    gnssSystems.value = []
  }
  try {
    bdsFreqs.value = await positioningApi.bdsFrequencies()
  } catch {
    bdsFreqs.value = []
  }
  try {
    correctionTypes.value = await positioningApi.correctionTypes()
  } catch {
    correctionTypes.value = []
  }
  try {
    bdsStatus.value = (await positioningApi.bdsStatus()) as Record<string, unknown>
  } catch {
    bdsStatus.value = null
  }
  try {
    gnssStatus.value = (await positioningApi.gnssStatus()) as Record<string, unknown>
  } catch {
    gnssStatus.value = null
  }
  try {
    rtkStatus.value = (await positioningApi.rtkStatus()) as Record<string, unknown>
  } catch {
    rtkStatus.value = null
  }
}
function startPolling() {
  loadMonitor()
  loadTasks()
  loadRefs()
  timer = window.setInterval(() => {
    loadMonitor()
    if (activeTab.value === 'task') loadTasks()
  }, 30000)
}

// ============ 操作 ============
async function doSpp() {
  loading.value = true
  try {
    sppResult.value = await positioningApi.sppSimple({
      lat: sppForm.lat,
      lon: sppForm.lon,
      alt: sppForm.alt,
      satellites: sppForm.satellites,
      system: sppForm.system,
      coordinateSystem: sppForm.cs,
    })
    toast('SPP 解算完成')
  } catch (e: any) {
    sppResult.value = null
    toast('解算失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doConvert() {
  loading.value = true
  try {
    coordResult.value = (await positioningApi.convert({
      lat: coordForm.lat,
      lon: coordForm.lon,
      alt: coordForm.alt,
      from: coordForm.from,
      to: coordForm.to,
    })) as Record<string, unknown>
    toast('坐标转换完成')
  } catch (e: any) {
    coordResult.value = null
    toast('转换失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doBds() {
  loading.value = true
  try {
    bdsResult.value = await positioningApi.bdsSolve({})
    toast('北斗三频解算完成')
  } catch (e: any) {
    bdsResult.value = null
    toast('解算失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doMulti() {
  loading.value = true
  try {
    multiResult.value = await positioningApi.multiGnssSolve({})
    toast('多系统联合解算完成')
  } catch (e: any) {
    multiResult.value = null
    toast('解算失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doRtk() {
  loading.value = true
  try {
    rtkResult.value = (await positioningApi.rtkSolve({
      baseLat: rtkForm.baseLat,
      baseLon: rtkForm.baseLon,
      baseAlt: rtkForm.baseAlt,
    })) as Record<string, unknown>
    toast('RTK 差分解算完成')
  } catch (e: any) {
    rtkResult.value = null
    toast('解算失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doGenerateCorrection() {
  loading.value = true
  try {
    correctionProduct.value = (await positioningApi.correctionGenerate({
      type: correctionTypes.value[0] || 'DGPS',
      baseLat: rtkForm.baseLat,
      baseLon: rtkForm.baseLon,
      baseAlt: rtkForm.baseAlt,
    })) as Record<string, unknown>
    toast('改正产品已生成')
  } catch (e: any) {
    correctionProduct.value = null
    toast('生成失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doApplyCorrection() {
  if (!correctionProduct.value) {
    toast('请先生成改正产品', 'error')
    return
  }
  loading.value = true
  try {
    applyResult.value = await positioningApi.correctionApply({
      observations: [{ satId: 'G01', system: 'GPS', pseudorange: 26530199.6 }],
      product: correctionProduct.value,
    })
    toast('改正已应用')
  } catch (e: any) {
    applyResult.value = null
    toast('应用失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doTerminal() {
  loading.value = true
  try {
    terminalResult.value = (await positioningApi.terminalLocate({
      lat: termForm.lat,
      lon: termForm.lon,
      alt: termForm.alt,
      terminalId: termForm.terminalId,
      system: termForm.system,
    })) as Record<string, unknown>
    toast('终端定位完成')
  } catch (e: any) {
    terminalResult.value = null
    toast('定位失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function doNmea() {
  loading.value = true
  try {
    nmeaResult.value = await positioningApi.terminalNmea()
    toast('NMEA 已获取')
  } catch (e: any) {
    nmeaResult.value = null
    toast('获取失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function createTask() {
  loading.value = true
  try {
    await positioningApi.createTask(taskForm.name, taskForm.mode)
    toast('任务已创建')
    await loadTasks()
  } catch (e: any) {
    toast('创建失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}
async function startTask(id: string) {
  try {
    await positioningApi.startTask(id)
    toast('任务已启动')
    await loadTasks()
  } catch (e: any) {
    toast('启动失败：' + e.message, 'error')
  }
}
async function viewTask(id: string) {
  try {
    taskDetail.value = await positioningApi.getTask(id)
    const r = await positioningApi.getTaskResult(id)
    taskResultText.value = r?.result || '（暂无结果）'
  } catch (e: any) {
    taskDetail.value = null
    taskResultText.value = '读取失败：' + e.message
  }
}
async function removeTask(id: string) {
  try {
    await positioningApi.deleteTask(id)
    toast('任务已删除')
    await loadTasks()
  } catch (e: any) {
    toast('删除失败：' + e.message, 'error')
  }
}

// ============ 计算 ============
const kpis = computed(() => [
  { label: '服务状态', value: fmt(health.value?.status) || (health.value ? 'UP' : '—'), unit: '', tone: health.value ? 'ok' : 'warn' },
  { label: '请求总数', value: fmtInt(stats.value?.requestCount), unit: '' },
  { label: '解算次数', value: fmtInt(stats.value?.solveCount), unit: '' },
  { label: '平均耗时', value: fmt(stats.value?.avgSolveMs, 1), unit: 'ms', tone: 'info' },
  { label: '运行任务', value: fmtInt(stats.value?.taskCount), unit: '' },
  { label: '运行时长', value: fmtInt(stats.value?.uptimeSeconds), unit: 's' },
  { label: '解算模式', value: fmt(appInfo.value?.mode) || 'SPP', unit: '' },
  { label: '引擎版本', value: fmt(version.value?.version) || '—', unit: '' },
])

const statusTone = (s?: string) => {
  if (!s) return 'default'
  if (s === 'CREATED') return 'info'
  if (s === 'RUNNING') return 'active'
  if (s === 'COMPLETED') return 'ok'
  if (s === 'FAILED' || s === 'STOPPED') return 'warn'
  return 'default'
}

const aiInsights = computed(() => {
  const arr: string[] = []
  if (!health.value) {
    arr.push('⚠️ 后端 18084 未连接：请确认同事机器上的 positioning-engine-service 已启动并开放端口。')
  } else {
    arr.push(`✅ 定位引擎在线（${fmt(health.value.status)}），默认模式 ${fmt(appInfo.value?.mode)}。`)
  }
  if (stats.value) {
    arr.push(`累计解算 ${fmtInt(stats.value.solveCount)} 次，平均耗时 ${fmt(stats.value.avgSolveMs, 1)}ms，运行任务 ${fmtInt(stats.value.taskCount)} 个。`)
  }
  if (gnssSystems.value.length) {
    arr.push(`支持卫星系统：${gnssSystems.value.join(' / ')}。`)
  }
  if (bdsFreqs.value.length) {
    arr.push(`北斗三频频点：${bdsFreqs.value.join(' / ')}。`)
  }
  if (sppResult.value) {
    arr.push(`最近 SPP 解算收敛=${sppResult.value.converged}，RMS=${fmt(sppResult.value.rms, 3)}m，参与卫星 ${fmtInt(sppResult.value.usedSatelliteCount)}/${fmtInt(sppResult.value.satelliteCount)}。`)
  }
  if (rtkResult.value) {
    arr.push(`最近 RTK 状态=${fmt(rtkResult.value.status)}，基线长 ${fmt(rtkResult.value.baselineLength, 3)}m，RMS=${fmt(rtkResult.value.rms, 3)}m。`)
  }
  return arr
})

onMounted(startPolling)
onUnmounted(() => timer && clearInterval(timer))

const tabs = [
  { key: 'monitor', label: '监控运维' },
  { key: 'spp', label: '单点定位' },
  { key: 'coord', label: '坐标转换' },
  { key: 'bds', label: '北斗三频' },
  { key: 'multi', label: '多系统' },
  { key: 'rtk', label: 'RTK差分' },
  { key: 'task', label: '解算任务' },
  { key: 'terminal', label: '终端定位' },
]
</script>

<template>
  <div class="module-view">
    <ConnectionStatus service-name="定位解算服务" :port="18084" health-path="/api/v1/positioning/health" mode="real" />
    <header class="module-header">
      <div>
        <h2 class="module-title">定位解算引擎 · AI</h2>
        <p class="module-sub">positioning-engine-service · 模块 4 定位解算 + 模块 32 终端定位</p>
      </div>
      <div class="header-actions">
        <span class="mode-pill">模式：{{ fmt(appInfo?.mode) || 'SPP' }}</span>
        <button class="btn ghost" @click="loadMonitor(); loadTasks(); loadRefs()">刷新</button>
      </div>
    </header>

    <!-- KPI -->
    <section class="kpi-row">
      <div v-for="k in kpis" :key="k.label" class="kpi-card" :class="'tone-' + (k.tone || 'default')">
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-value">{{ k.value }}<small v-if="k.unit"> {{ k.unit }}</small></div>
      </div>
    </section>

    <!-- Tabs -->
    <nav class="tab-bar">
      <button v-for="t in tabs" :key="t.key" class="tab" :class="{ active: activeTab === t.key }" @click="activeTab = t.key">
        {{ t.label }}
      </button>
    </nav>

    <div class="tab-body">
      <!-- 1. 监控运维 -->
      <div v-show="activeTab === 'monitor'" class="tab-pane">
        <div class="grid-2">
          <div class="panel">
            <h3>服务健康</h3>
            <pre class="json-box">{{ health ? JSON.stringify(health, null, 2) : '（空态：请确认后端 18084 已启动）' }}</pre>
          </div>
          <div class="panel">
            <h3>统计信息</h3>
            <pre class="json-box">{{ stats ? JSON.stringify(stats, null, 2) : '（空态）' }}</pre>
          </div>
        </div>
        <div class="grid-2">
          <div class="panel">
            <h3>版本</h3>
            <pre class="json-box">{{ version ? JSON.stringify(version, null, 2) : '（空态）' }}</pre>
          </div>
          <div class="panel">
            <h3>应用信息</h3>
            <pre class="json-box">{{ appInfo ? JSON.stringify(appInfo, null, 2) : '（空态）' }}</pre>
          </div>
        </div>
      </div>

      <!-- 2. 单点定位 -->
      <div v-show="activeTab === 'spp'" class="tab-pane">
        <div class="panel">
          <h3>SPP 简化解算（自动模拟观测）</h3>
          <div class="form-row">
            <label>纬度<input v-model.number="sppForm.lat" type="number" step="0.0001" /></label>
            <label>经度<input v-model.number="sppForm.lon" type="number" step="0.0001" /></label>
            <label>高程<input v-model.number="sppForm.alt" type="number" /></label>
            <label>卫星数<input v-model.number="sppForm.satellites" type="number" /></label>
            <label>系统
              <select v-model="sppForm.system">
                <option>GPS</option><option>BDS</option><option>GALILEO</option><option>GLONASS</option>
              </select>
            </label>
            <label>坐标系
              <select v-model="sppForm.cs">
                <option>CGCS2000</option><option>WGS84</option><option>GRS80</option><option>PZ90</option>
              </select>
            </label>
            <button class="btn primary" :disabled="loading" @click="doSpp">解算</button>
          </div>
          <pre class="json-box">{{ sppResult ? JSON.stringify(sppResult, null, 2) : '（点击「解算」查看结果）' }}</pre>
        </div>
      </div>

      <!-- 3. 坐标转换 -->
      <div v-show="activeTab === 'coord'" class="tab-pane">
        <div class="panel">
          <h3>BLH ↔ ECEF 坐标转换</h3>
          <div class="form-row">
            <label>纬度<input v-model.number="coordForm.lat" type="number" step="0.0001" /></label>
            <label>经度<input v-model.number="coordForm.lon" type="number" step="0.0001" /></label>
            <label>高程<input v-model.number="coordForm.alt" type="number" /></label>
            <label>源坐标系
              <select v-model="coordForm.from">
                <option v-for="s in (coordSystems.length ? coordSystems : ['WGS84','CGCS2000','GRS80','PZ90'])" :key="s">{{ s }}</option>
              </select>
            </label>
            <label>目标坐标系
              <select v-model="coordForm.to">
                <option v-for="s in (coordSystems.length ? coordSystems : ['WGS84','CGCS2000','GRS80','PZ90'])" :key="s">{{ s }}</option>
              </select>
            </label>
            <button class="btn primary" :disabled="loading" @click="doConvert">转换</button>
          </div>
          <pre class="json-box">{{ coordResult ? JSON.stringify(coordResult, null, 2) : '（点击「转换」查看结果）' }}</pre>
        </div>
      </div>

      <!-- 4. 北斗三频 -->
      <div v-show="activeTab === 'bds'" class="tab-pane">
        <div class="grid-2">
          <div class="panel">
            <h3>BDS 状态 / 频点</h3>
            <pre class="json-box">{{ JSON.stringify({ status: bdsStatus, frequencies: bdsFreqs }, null, 2) }}</pre>
          </div>
          <div class="panel">
            <h3>三频联合解算</h3>
            <button class="btn primary" :disabled="loading" @click="doBds">三频解算</button>
            <pre class="json-box mt">{{ bdsResult ? JSON.stringify(bdsResult, null, 2) : '（点击解算）' }}</pre>
          </div>
        </div>
      </div>

      <!-- 5. 多系统 -->
      <div v-show="activeTab === 'multi'" class="tab-pane">
        <div class="panel">
          <h3>多系统联合解算（GPS+BDS+GALILEO+GLONASS）</h3>
          <pre class="json-box">{{ gnssStatus ? JSON.stringify(gnssStatus, null, 2) : '（空态）' }}</pre>
          <button class="btn primary" :disabled="loading" @click="doMulti">联合解算</button>
          <pre class="json-box mt">{{ multiResult ? JSON.stringify(multiResult, null, 2) : '（点击解算）' }}</pre>
        </div>
      </div>

      <!-- 6. RTK 差分 -->
      <div v-show="activeTab === 'rtk'" class="tab-pane">
        <div class="panel">
          <h3>RTK 差分解算</h3>
          <div class="form-row">
            <label>基准纬度<input v-model.number="rtkForm.baseLat" type="number" step="0.0001" /></label>
            <label>基准经度<input v-model.number="rtkForm.baseLon" type="number" step="0.0001" /></label>
            <label>基准高程<input v-model.number="rtkForm.baseAlt" type="number" /></label>
            <button class="btn primary" :disabled="loading" @click="doRtk">RTK 解算</button>
          </div>
          <pre class="json-box">{{ rtkResult ? JSON.stringify(rtkResult, null, 2) : '（点击解算）' }}</pre>
        </div>
        <div class="panel">
          <h3>差分改正产品（{{ (correctionTypes.length ? correctionTypes.join('/') : 'DGPS/RTK') }}）</h3>
          <div class="form-row">
            <button class="btn primary" :disabled="loading" @click="doGenerateCorrection">生成改正</button>
            <button class="btn" :disabled="loading" @click="doApplyCorrection">应用改正</button>
          </div>
          <pre class="json-box">{{ correctionProduct ? JSON.stringify(correctionProduct, null, 2) : '（生成后展示）' }}</pre>
          <pre class="json-box mt" v-if="applyResult">{{ JSON.stringify(applyResult, null, 2) }}</pre>
        </div>
      </div>

      <!-- 7. 解算任务 -->
      <div v-show="activeTab === 'task'" class="tab-pane">
        <div class="panel">
          <h3>创建解算任务</h3>
          <div class="form-row">
            <label>任务名<input v-model="taskForm.name" /></label>
            <label>模式
              <select v-model="taskForm.mode">
                <option>SPP</option><option>RTK</option><option>BDS_TRIPLE</option><option>MULTI_GNSS</option>
              </select>
            </label>
            <button class="btn primary" :disabled="loading" @click="createTask">创建</button>
          </div>
        </div>
        <div class="panel">
          <h3>任务列表（共 {{ tasks.length }} 个）</h3>
          <table class="data-table">
            <thead>
              <tr><th>任务ID</th><th>名称</th><th>模式</th><th>状态</th><th>进度</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in tasks" :key="t.taskId">
                <td>{{ t.taskId }}</td>
                <td>{{ t.name }}</td>
                <td>{{ t.mode }}</td>
                <td><span class="tag" :class="'tag-' + statusTone(t.status)">{{ t.status }}</span></td>
                <td>{{ t.progress ?? 0 }}%</td>
                <td class="ops">
                  <button class="btn xs" @click="startTask(t.taskId!)">启动</button>
                  <button class="btn xs" @click="viewTask(t.taskId!)">详情</button>
                  <button class="btn xs danger" @click="removeTask(t.taskId!)">删除</button>
                </td>
              </tr>
              <tr v-if="!tasks.length"><td colspan="6" class="empty">暂无任务（请确认后端已启动）</td></tr>
            </tbody>
          </table>
          <div v-if="taskDetail" class="detail-box">
            <h4>任务详情：{{ taskDetail.taskId }}</h4>
            <pre class="json-box">{{ JSON.stringify(taskDetail, null, 2) }}</pre>
            <h4>解算结果</h4>
            <pre class="json-box">{{ taskResultText }}</pre>
          </div>
        </div>
      </div>

      <!-- 8. 终端定位 -->
      <div v-show="activeTab === 'terminal'" class="tab-pane">
        <div class="panel">
          <h3>终端定位（模块 32）</h3>
          <div class="form-row">
            <label>纬度<input v-model.number="termForm.lat" type="number" step="0.0001" /></label>
            <label>经度<input v-model.number="termForm.lon" type="number" step="0.0001" /></label>
            <label>高程<input v-model.number="termForm.alt" type="number" /></label>
            <label>终端ID<input v-model="termForm.terminalId" /></label>
            <label>系统
              <select v-model="termForm.system"><option>GPS</option><option>BDS</option></select>
            </label>
            <button class="btn primary" :disabled="loading" @click="doTerminal">定位</button>
            <button class="btn" :disabled="loading" @click="doNmea">获取 NMEA</button>
          </div>
          <pre class="json-box">{{ terminalResult ? JSON.stringify(terminalResult, null, 2) : '（点击定位）' }}</pre>
          <pre class="json-box mt" v-if="nmeaResult">NMEA 语句数：{{ (nmeaResult.sentences || []).length }}
{{ nmeaResult.raw || '' }}</pre>
        </div>
      </div>
    </div>

    <!-- AI 洞察 -->
    <section class="ai-panel">
      <div class="ai-head">🤖 AI 解算洞察</div>
      <ul class="ai-list">
        <li v-for="(a, i) in aiInsights" :key="i">{{ a }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.module-view { padding: 20px 24px 32px; max-width: 1320px; margin: 0 auto; }
.module-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.module-title { font-size: 22px; font-weight: 600; color: #1a1a2e; margin: 0; }
.module-sub { font-size: 13px; color: #888; margin: 4px 0 0; }
.header-actions { display: flex; align-items: center; gap: 12px; }
.mode-pill { font-size: 12px; padding: 4px 12px; border-radius: 12px; background: #e6f7ff; color: #1890ff; }
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
.kpi-card { background: #fff; border: 1px solid #eef0f3; border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.kpi-label { font-size: 12px; color: #8a90a3; margin-bottom: 8px; }
.kpi-value { font-size: 24px; font-weight: 600; color: #1a1a2e; }
.kpi-value small { font-size: 12px; color: #8a90a3; font-weight: 400; }
.tone-ok { border-left: 3px solid #52c41a; }
.tone-warn { border-left: 3px solid #faad14; }
.tone-info { border-left: 3px solid #1890ff; }
.tab-bar { display: flex; gap: 4px; border-bottom: 1px solid #eef0f3; margin-bottom: 16px; flex-wrap: wrap; }
.tab { padding: 10px 16px; border: none; background: transparent; font-size: 14px; color: #595959; cursor: pointer; border-bottom: 2px solid transparent; }
.tab.active { color: #1890ff; border-bottom-color: #1890ff; font-weight: 500; }
.tab-pane { animation: fade .2s; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.panel { background: #fff; border: 1px solid #eef0f3; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
.panel h3 { font-size: 15px; margin: 0 0 12px; color: #1a1a2e; }
.panel h4 { font-size: 13px; margin: 14px 0 6px; color: #444; }
.form-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 12px; }
.form-row label { display: flex; flex-direction: column; font-size: 12px; color: #666; gap: 4px; }
.form-row input, .form-row select { padding: 7px 10px; border: 1px solid #d9d9d9; border-radius: 8px; font-size: 13px; min-width: 120px; }
.btn { padding: 8px 16px; border-radius: 8px; border: 1px solid #d9d9d9; background: #fff; color: #333; cursor: pointer; font-size: 13px; }
.btn.primary { background: #1890ff; border-color: #1890ff; color: #fff; }
.btn.ghost { background: #fafafa; }
.btn.xs { padding: 4px 9px; font-size: 12px; }
.btn.danger { color: #ff4d4f; border-color: #ffccc7; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.json-box { background: #0f1420; color: #d6e2ff; border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.55; overflow: auto; max-height: 360px; font-family: 'SFMono-Regular', Consolas, monospace; white-space: pre; }
.json-box.mt { margin-top: 10px; }
.detail-box { margin-top: 12px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #f0f0f0; }
.data-table th { background: #fafafa; color: #666; font-weight: 500; }
.data-table .ops { display: flex; gap: 6px; }
.empty { text-align: center; color: #aaa; padding: 18px; }
.tag { padding: 2px 9px; border-radius: 10px; font-size: 12px; }
.tag-info { background: #e6f7ff; color: #1890ff; }
.tag-active { background: #f9f0ff; color: #722ed1; }
.tag-ok { background: #f6ffed; color: #52c41a; }
.tag-warn { background: #fffbe6; color: #faad14; }
.tag-default { background: #f0f0f0; color: #888; }
.ai-panel { background: linear-gradient(135deg, #f6fbff, #f3f0ff); border: 1px solid #e6f0ff; border-radius: 12px; padding: 16px 18px; margin-top: 6px; }
.ai-head { font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 10px; }
.ai-list { margin: 0; padding-left: 18px; color: #444; font-size: 13px; line-height: 1.8; }
</style>
