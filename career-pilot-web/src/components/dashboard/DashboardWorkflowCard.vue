<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Loading, MagicStick } from '@element-plus/icons-vue'

import { createOptimization, getOptimization, retryOptimization } from '@/api/optimization'
import AnalysisStateTag from '@/components/AnalysisStateTag.vue'
import ResourcePicker from '@/components/ResourcePicker.vue'
import ScoreRing from '@/components/ScoreRing.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 工作台「核心 AI 求职工作流」（《前端原型设计》§5.2）。
 *
 * 五个步骤：① 选择简历 → ② 选择岗位 → ③ 匹配分析 → ④ 简历优化 → ⑤ AI 面试。
 *
 * **③ 与 ④ 共享同一次启动**：后端不存在独立的「匹配分析」操作——`match_record` 只在
 * 简历定向优化任务的异步链路内部产生（`POST /api/optimizations` → MATCHING 生成匹配分
 * 与能力差距 → GENERATING 生成优化稿 → SUCCESS）。因此本卡片只调 `createOptimization`，
 * 绝不另起一套匹配/优化业务逻辑。
 *
 * **状态来源**：③④ 的状态与分数取自当前聚焦的优化记录（详情优先，含 `stage` 与
 * `matchId`；列表行仅有 status/matchScore）。⚠️ 判定「匹配已完成」**必须用 `matchId != null`**：
 * 详情 DTO 的 `matchScore` 是 Java primitive double，匹配未发生时后端不装配、返回 0.0。
 *
 * **进行中不跳转**：任务在服务端执行，卡片内每 3 秒轮询 `GET /api/optimizations/{id}`
 * 展示真实阶段（与优化工作台同一口径）；中途离开页面不影响结果。
 */
const props = defineProps({
  /** GET /api/dashboard/summary 响应；未加载完（或加载失败）时为 null */
  summary: { type: Object, default: null },
  /** 最近 5 条优化记录（GET /api/optimizations） */
  optimizations: { type: Array, default: () => [] },
  /** 最近 5 条面试记录（GET /api/interviews） */
  interviews: { type: Array, default: () => [] },
  /** optimizations 请求的加载/错误态（工作流状态推导依赖该列表） */
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['changed', 'retry'])

const router = useRouter()

/* ---------------------------------------------------------------- 资源选择 */

const resumeId = ref(null)
const jobId = ref(null)
/** 选中项的完整记录（含 analyzed / stale），用于状态标签与就地拦截 */
const selectedResume = ref(null)
const selectedJob = ref(null)

const pickerVisible = ref(false)
/** 当前打开的选择器：'resume' | 'job' | null */
const pickerKind = ref(null)

function openPicker(kind) {
  pickerKind.value = kind
  pickerVisible.value = true
}

function onResumeSelect(item) {
  selectedResume.value = item
}

function onJobSelect(item) {
  selectedJob.value = item
}

/**
 * 选中项的就地拦截（与 ResourcePicker 同口径，见《前端原型设计》§5.7）：
 * 简历未分析、岗位未分析或分析已过期时禁止启动，并给出原因与修复入口。
 */
const blockedNotice = computed(() => {
  const resume = selectedResume.value
  if (resume && !resume.analyzed) {
    return {
      title: `「${resume.name}」还没有完成分析`,
      text: '匹配需要双方的技能项作为依据，请先完成这份简历的分析。',
      fix: { name: 'resume-analysis', params: { id: resume.id }, query: { auto: '1' } },
      fixText: '立即分析',
    }
  }
  const job = selectedJob.value
  if (job && !job.analyzed) {
    return {
      title: `「${job.jobName}」还没有完成分析`,
      text: '匹配需要双方的技能项作为依据，请先完成这个岗位的分析。',
      fix: { name: 'job-analysis', params: { id: job.id }, query: { auto: '1' } },
      fixText: '立即分析',
    }
  }
  if (job && job.stale) {
    return {
      title: `「${job.jobName}」的分析已过期`,
      text: '岗位描述在分析后已更新，请先重新分析，再基于新版要求发起匹配。',
      fix: { name: 'job-analysis', params: { id: job.id } },
      fixText: '去重新分析',
    }
  }
  return null
})

/* ---------------------------------------------------------------- 任务与轮询 */

const starting = ref(false)
/** 启动阶段的失败（400 前置条件 / 502 模型不可用）；null 表示无 */
const startError = ref(null)
const retrying = ref(false)

/** 当前聚焦的优化记录 id */
const focusedId = ref(null)
/** 当前聚焦的优化详情（含 stage / matchId / 差距 / errorMessage） */
const detail = ref(null)

let pollTimer = null
/** 递增令牌：切换焦点后丢弃在途响应，避免旧请求覆盖新状态 */
let pollToken = 0

const isTerminal = (status) => status === 'SUCCESS' || status === 'FAILED'

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function loadDetail(id, { notify = false } = {}) {
  const token = ++pollToken
  try {
    const data = await getOptimization(id)
    if (token !== pollToken) {
      return
    }
    const wasTerminal = isTerminal(detail.value?.status)
    detail.value = data
    if (isTerminal(data.status)) {
      stopPolling()
      // 只对「本次运行完成」通知父级刷新；回看历史记录不触发
      if (notify && !wasTerminal) {
        emit('changed')
      }
    }
  }
  catch {
    // 单轮失败忽略，下一轮继续（与优化工作台轮询口径一致）
  }
}

function startPolling() {
  if (pollTimer) {
    return
  }
  loadDetail(focusedId.value, { notify: true })
  pollTimer = setInterval(() => loadDetail(focusedId.value, { notify: true }), 3000)
}

/** 切换聚焦的优化记录；同一条记录不重置已加载的详情 */
function setFocus(id, { poll = false } = {}) {
  const same = id !== null && id === focusedId.value
  stopPolling()
  pollToken += 1
  focusedId.value = id
  if (id === null) {
    detail.value = null
    return
  }
  if (!same) {
    detail.value = null
  }
  if (poll) {
    startPolling()
  }
  else if (!same) {
    loadDetail(id)
  }
}

/** 与当前所选组合配对的最近一条优化记录（列表限最近 5 条） */
const pairRecord = computed(() => {
  if (resumeId.value === null || jobId.value === null) {
    return null
  }
  return props.optimizations.find(
    (item) => item.resumeId === resumeId.value && item.jobId === jobId.value,
  ) ?? null
})

/**
 * 重新确定焦点：**运行中的任务优先**（用户离开再回来要能接上），其次是与所选组合
 * 配对的历史记录，最后清空。
 */
function refocus() {
  if (starting.value) {
    return
  }
  const inflight = props.optimizations.find(
    (item) => item.status === 'PENDING' || item.status === 'PROCESSING',
  )
  if (inflight) {
    setFocus(inflight.id, { poll: true })
    return
  }
  const record = pairRecord.value
  if (record) {
    setFocus(record.id)
    return
  }
  setFocus(null)
}

watch([resumeId, jobId], refocus)
watch(() => props.optimizations, refocus, { immediate: true })

onUnmounted(stopPolling)

/* ---------------------------------------------------------------- 状态推导 */

const focusStatus = computed(() => detail.value?.status ?? pairRecord.value?.status ?? null)

const focusStage = computed(() => detail.value?.stage ?? null)

const running = computed(() => focusStatus.value === 'PENDING' || focusStatus.value === 'PROCESSING')

const failed = computed(() => focusStatus.value === 'FAILED')

/**
 * 匹配是否已完成：SUCCESS 必然经过 MATCHING；详情带 matchId 即已写回匹配记录；
 * PROCESSING 已进入 GENERATING 阶段说明匹配已过。**不得用 matchScore > 0 判定**——
 * 未匹配时后端返回的是 primitive double 的默认值 0.0。
 */
const matchDone = computed(() => {
  if (focusStatus.value === 'SUCCESS') {
    return true
  }
  if (detail.value?.matchId != null) {
    return true
  }
  return focusStage.value === 'GENERATING'
})

/** 匹配度：仅匹配完成后展示（列表行的 matchScore 在任务未完成时为 null） */
const matchScore = computed(() => {
  if (!matchDone.value) {
    return null
  }
  const score = detail.value?.matchScore ?? pairRecord.value?.matchScore
  return score === null || score === undefined ? null : Number(score)
})

const optimizationDone = computed(() => focusStatus.value === 'SUCCESS')

/** 是否已经跑过至少一次：首次启动写「开始」，之后写「再跑一次」 */
const hasCompletedRun = computed(() => matchDone.value || (props.summary?.matchCount ?? 0) > 0)

/** 已成功的优化记录 id（第 ⑤ 步的面试来源） */
const sourceOptimizationId = computed(() => {
  if (optimizationDone.value) {
    return focusedId.value
  }
  return pairRecord.value?.status === 'SUCCESS' ? pairRecord.value.id : null
})

/** 是否完成过一次模拟面试：优先按来源优化 / 目标岗位匹配，最后回落到全局计数 */
const interviewDone = computed(() => {
  const hasContext = resumeId.value !== null || jobId.value !== null
  if (hasContext) {
    if (sourceOptimizationId.value !== null
      && props.interviews.some((item) => item.optimizationId === sourceOptimizationId.value && item.status === 1)) {
      return true
    }
    if (jobId.value !== null
      && props.interviews.some((item) => item.jobId === jobId.value && item.status === 1)) {
      return true
    }
    return false
  }
  return (props.summary?.interviewCompletedCount ?? 0) > 0
})

/* ---------------------------------------------------------------- 五步 */

/** 运行中任务的阶段文案（stage 仅进行中的详情有值） */
const stageText = computed(() => {
  if (focusStatus.value === 'PENDING') {
    return '任务已排队，等待开始…'
  }
  if (focusStatus.value === 'PROCESSING') {
    return focusStage.value === 'GENERATING'
      ? '正在按岗位要求生成优化稿…'
      : '正在做岗位匹配分析…'
  }
  return ''
})

const steps = computed(() => {
  const s = props.summary
  const resumeCount = s?.resumeCount ?? 0
  const usableJobs = (s?.jobAnalyzedCount ?? 0) - (s?.jobStaleCount ?? 0)
  const hasPairContext = resumeId.value !== null || jobId.value !== null

  // ① 简历：选中即完成；未选中时看库里是否已有简历
  const resumeState = resumeId.value !== null || resumeCount > 0 ? 'done' : 'todo'

  // ② 岗位：选中即完成；未选中时看库里是否已有「已分析且未过期」的岗位
  const jobState = jobId.value !== null || usableJobs > 0 ? 'done' : 'todo'

  // ③ 匹配分析 / ④ 简历优化：聚焦了记录就按它判，否则回落到全局统计
  let matchState = 'todo'
  let optimizationState = 'todo'
  if (focusStatus.value !== null) {
    matchState = matchDone.value ? 'done' : 'todo'
    optimizationState = optimizationDone.value ? 'done' : failed.value ? 'failed' : running.value ? 'doing' : 'todo'
  }
  else if (!hasPairContext) {
    matchState = (s?.matchCount ?? 0) > 0 ? 'done' : 'todo'
    optimizationState = props.optimizations.some((item) => item.status === 'SUCCESS') ? 'done' : 'todo'
  }

  // ⑤ 面试
  const interviewState = interviewDone.value ? 'done' : 'todo'

  return [
    {
      key: 'resume',
      title: '选择简历',
      state: resumeState,
      text: selectedResume.value?.name
        ?? (resumeCount > 0 ? `已有 ${resumeCount} 份简历，选一份开始` : '还没有简历，先上传一份'),
      tag: selectedResume.value
        ? { analyzed: selectedResume.value.analyzed, stale: selectedResume.value.stale }
        : null,
      action: { text: selectedResume.value ? '更换' : '选择简历', pick: 'resume' },
    },
    {
      key: 'job',
      title: '选择岗位',
      state: jobState,
      text: selectedJob.value?.jobName
        ?? (usableJobs > 0 ? `已有 ${usableJobs} 个已分析岗位可选` : '选择目标岗位，或粘贴一份 JD'),
      tag: selectedJob.value
        ? { analyzed: selectedJob.value.analyzed, stale: selectedJob.value.stale }
        : null,
      action: { text: selectedJob.value ? '更换' : '选择岗位', pick: 'job' },
    },
    {
      key: 'match',
      title: '匹配分析',
      state: matchState,
      text: matchDone.value
        ? `匹配度 ${matchScore.value ?? '—'} 分`
        : (focusStatus.value !== null && running.value ? '正在分析岗位要求与简历…' : '启动后自动完成匹配，给出匹配度与能力差距'),
      action: matchDone.value && sourceOptimizationId.value !== null
        ? { text: '查看优化稿', detail: true }
        : null,
    },
    {
      key: 'optimization',
      title: '简历优化',
      state: optimizationState,
      text: optimizationDone.value
        ? '优化稿已生成，可编辑、评估与导出'
        : (running.value
          ? (focusStage.value === 'GENERATING' ? '正在生成优化稿…' : '等待匹配完成后生成')
          : (failed.value ? '本次生成失败，可重试' : '匹配完成后按岗位要求改写简历')),
      action: optimizationDone.value && sourceOptimizationId.value !== null
        ? { text: '查看优化稿', detail: true }
        : null,
    },
    {
      key: 'interview',
      title: 'AI 面试',
      state: interviewState,
      text: interviewDone.value
        ? '已完成过模拟面试'
        : '按目标岗位生成面试题，进入 AI 模拟面试',
      action: {
        text: '去面试',
        to: sourceOptimizationId.value !== null
          ? { name: 'interviews', query: { optimizationId: sourceOptimizationId.value } }
          : { name: 'interviews' },
      },
    },
  ]
})

const doneCount = computed(() => steps.value.filter((step) => step.state === 'done').length)

const donePercent = computed(() => Math.round((doneCount.value / steps.value.length) * 100))

/* ---------------------------------------------------------------- 能力差距 */

/** 当前聚焦记录的匹配差距（详情优先）；无聚焦记录时回落到「最近一次匹配」 */
const gaps = computed(() => {
  const d = detail.value
  if (d && (d.missingItems || d.partialItems)) {
    return [
      ...(d.missingItems ?? []).map((item) => ({ type: 'MISSING', text: item.text })),
      ...(d.partialItems ?? []).map((item) => ({ type: 'PARTIAL', text: item.text })),
    ].slice(0, 3)
  }
  return props.summary?.topGaps ?? []
})

/** 差距来源说明：避免把别的组合的差距误读成本次所选组合的结论 */
const gapsSource = computed(() => {
  const d = detail.value
  if (d && (d.missingItems || d.partialItems)) {
    return `来自「${d.resumeName} × ${d.jobName}」`
  }
  return '来自最近一次匹配'
})

/* ---------------------------------------------------------------- 动作 */

const canStart = computed(() => (
  !starting.value
  && !running.value
  && resumeId.value !== null
  && jobId.value !== null
  && blockedNotice.value === null
))

async function start() {
  if (!canStart.value) {
    return
  }
  starting.value = true
  startError.value = null
  try {
    const created = await createOptimization({ resumeId: resumeId.value, jobId: jobId.value })
    // 异步链路返回 PENDING；同步降级路径下 created 可能已是终态
    setFocus(created.id, { poll: !isTerminal(created.status) })
    detail.value = created
    emit('changed')
  }
  catch (error) {
    startError.value = {
      message: error.message || '启动失败，请稍后重试',
      // 50200/50201 为模型不可用——本次未产生记录，可安全重试
      retriable: error.code === 50200 || error.code === 50201,
    }
  }
  finally {
    starting.value = false
  }
}

async function retry() {
  if (retrying.value) {
    return
  }
  retrying.value = true
  startError.value = null
  try {
    const data = await retryOptimization(focusedId.value)
    detail.value = data
    startPolling()
  }
  catch (error) {
    startError.value = { message: error.message || '重试失败，请稍后重试', retriable: false }
  }
  finally {
    retrying.value = false
  }
}

function openDetail() {
  if (focusedId.value !== null) {
    router.push({ name: 'optimization-detail', params: { id: focusedId.value } })
  }
}

function handleAction(action) {
  if (!action) {
    return
  }
  if (action.pick) {
    openPicker(action.pick)
  }
  else if (action.to) {
    router.push(action.to)
  }
  else if (action.detail) {
    openDetail()
  }
}
</script>

<template>
  <el-card shadow="never" class="workflow">
    <template #header>
      <div class="card__head">
        <h2>核心 AI 求职工作流</h2>
        <span class="card__sub">选简历 → 选岗位 → 匹配分析 → 优化简历 → AI 面试</span>
      </div>
    </template>

    <StateBlock :loading="loading" :error="error" @retry="emit('retry')">
      <!-- 进度：五步完成度（沿用 .progress-row 口径，与「求职准备清单」同构） -->
      <div class="progress-row">
        <span class="progress-row__muted">已完成 {{ doneCount }} / {{ steps.length }}</span>
        <span class="progress-row__strong">{{ donePercent }}%</span>
      </div>
      <el-progress class="progress" :percentage="donePercent" :show-text="false" />

      <!-- 五个步骤 -->
      <div class="steps">
        <div
          v-for="(step, index) in steps"
          :key="step.key"
          class="step"
          :class="`step--${step.state}`"
        >
          <div class="step__head">
            <span class="step__no">{{ step.state === 'done' ? '✓' : index + 1 }}</span>
            <span class="step__title">{{ step.title }}</span>
          </div>
          <div class="step__main">
            <span class="step__text">{{ step.text }}</span>
            <AnalysisStateTag
              v-if="step.tag"
              class="step__tag"
              :analyzed="step.tag.analyzed"
              :stale="step.tag.stale"
            />
          </div>
          <div v-if="step.action" class="step__foot">
            <el-button size="small" @click="handleAction(step.action)">
              {{ step.action.text }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- 选中项的拦截提示（未分析 / 分析已过期）：给出原因与修复入口 -->
      <el-alert
        v-if="blockedNotice"
        class="block-notice"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #title>{{ blockedNotice.title }}</template>
        <p class="block-notice__text">{{ blockedNotice.text }}</p>
        <el-button
          class="block-notice__btn"
          size="small"
          type="warning"
          plain
          @click="router.push(blockedNotice.fix)"
        >
          {{ blockedNotice.fixText }}
        </el-button>
      </el-alert>

      <!-- 操作区：运行中 / 失败 / 启动 -->
      <div class="run">
        <div v-if="running" class="run__row run__row--ing">
          <el-icon class="run__spin" :size="18"><Loading /></el-icon>
          <div class="run__text">
            <div class="run__title">{{ stageText }}</div>
            <div class="run__hint">
              预计 1–3 分钟；中途关闭页面不会影响结果，稍后可在「简历定向优化」中查看。
            </div>
          </div>
          <el-button size="small" @click="openDetail">
            打开工作台
          </el-button>
        </div>

        <el-alert
          v-else-if="failed"
          class="run__alert"
          type="error"
          :closable="false"
          show-icon
        >
          <template #title>优化任务失败</template>
          <p class="run__hint">{{ detail?.errorMessage || '任务执行失败，可重试。' }}</p>
          <div class="run__actions">
            <el-button size="small" type="primary" :loading="retrying" @click="retry">
              重试
            </el-button>
            <el-button size="small" @click="openDetail">
              打开工作台
            </el-button>
          </div>
        </el-alert>

        <div v-else class="run__row">
          <el-button
            type="primary"
            :icon="MagicStick"
            :disabled="!canStart"
            :loading="starting"
            @click="start"
          >
            {{ hasCompletedRun ? '再跑一次匹配与优化' : '开始匹配与优化' }}
          </el-button>
          <span class="run__hint">
            <template v-if="resumeId === null || jobId === null">
              先在上方选择一份简历与一个目标岗位。
            </template>
            <template v-else-if="blockedNotice">
              所选资源还不满足匹配条件，先按提示处理。
            </template>
            <template v-else>
              一次启动即完成岗位匹配分析与优化稿生成，预计 1–3 分钟。
            </template>
          </span>
          <el-button link type="primary" @click="router.push({ name: 'optimizations', query: { create: '1' } })">
            没有合适的岗位？粘贴一份 JD
          </el-button>
        </div>

        <el-alert
          v-if="startError"
          class="run__alert"
          type="error"
          :closable="false"
          show-icon
        >
          {{ startError.message }}<template v-if="startError.retriable">（本次未产生任务，可以重试）</template>
        </el-alert>
      </div>

      <!-- 结果区：匹配度与能力差距 -->
      <div v-if="matchScore !== null || gaps.length > 0" class="result">
        <div class="result__head">
          <h3>{{ matchScore !== null ? '匹配分析结果' : '能力差距概览' }}</h3>
          <span class="card__sub">{{ gapsSource }}</span>
        </div>

        <div class="result__body">
          <ScoreRing v-if="matchScore !== null" :score="matchScore" :size="104" />

          <div class="result__gaps">
            <p v-if="gaps.length === 0" class="block-empty">
              本次匹配未发现明显的能力缺口。
            </p>
            <template v-else>
              <div v-for="(gap, index) in gaps" :key="index" class="gap-item">
                <el-tag
                  :type="gap.type === 'MISSING' ? 'danger' : 'warning'"
                  size="small"
                  effect="light"
                >
                  {{ gap.type === 'MISSING' ? '未体现' : '部分匹配' }}
                </el-tag>
                <span>{{ gap.text }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </StateBlock>

    <!-- 资源选择弹窗：复用 ResourcePicker（含未分析 / 过期就地拦截） -->
    <el-dialog
      v-model="pickerVisible"
      :title="pickerKind === 'resume' ? '选择简历' : '选择目标岗位'"
      width="640px"
    >
      <ResourcePicker
        v-if="pickerKind === 'resume'"
        v-model="resumeId"
        type="resume"
        @select="onResumeSelect"
      />
      <ResourcePicker
        v-else-if="pickerKind === 'job'"
        v-model="jobId"
        type="job"
        @select="onJobSelect"
      />
      <template #footer>
        <el-button type="primary" @click="pickerVisible = false">
          完成
        </el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.workflow {
  border-radius: var(--radius);
  margin-bottom: 16px;
}

.workflow :deep(.el-card__header) {
  padding: 14px 18px;
}

.workflow :deep(.el-card__body) {
  padding: 18px;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card__head h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.card__sub {
  font-size: 12px;
  color: var(--ink-400);
}

/* ---------------------------------------------------------------- 进度 */

.progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}

.progress-row__muted {
  color: var(--ink-500);
}

.progress-row__strong {
  font-weight: 600;
  color: var(--ink-900);
}

.progress {
  margin-bottom: 16px;
}

/* ---------------------------------------------------------------- 五个步骤 */

.steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.step--done {
  border-color: var(--brand-200);
  background: var(--brand-50);
}

.step--doing {
  border-color: var(--brand-500);
}

.step--failed {
  border-color: var(--danger, #f56c6c);
  background: var(--danger-bg, #fef0f0);
}

.step__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.step__no {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  background: var(--bg);
  color: var(--ink-500);
  border: 1px solid var(--line);
}

.step--done .step__no {
  background: var(--brand-600);
  color: #fff;
  border-color: transparent;
}

.step--failed .step__no {
  background: var(--danger, #f56c6c);
  color: #fff;
  border-color: transparent;
}

.step__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.step__text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-500);
  /* 岗位名可能很长：允许换行、不做单行省略，避免信息被截断 */
  overflow-wrap: anywhere;
}

.step__foot {
  margin-top: auto;
}

/* ---------------------------------------------------------------- 拦截提示 */

.block-notice {
  margin-top: 14px;
}

.block-notice__text {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

.block-notice__btn {
  margin-top: 8px;
}

/* ---------------------------------------------------------------- 操作区 */

.run {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.run__row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.run__row--ing {
  align-items: flex-start;
}

.run__spin {
  color: var(--brand-600);
  animation: run-spin 1.2s linear infinite;
}

@keyframes run-spin {
  to {
    transform: rotate(360deg);
  }
}

.run__text {
  flex: 1;
  min-width: 200px;
}

.run__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-900);
}

.run__hint {
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-400);
}

.run__actions {
  margin-top: 8px;
}

.run__alert {
  margin-top: 0;
}

.run > .run__alert + .run__alert,
.run > .run__row + .run__alert {
  margin-top: 12px;
}

/* ---------------------------------------------------------------- 结果区 */

.result {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.result__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.result__head h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-900);
}

.result__body {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.result__gaps {
  flex: 1;
  min-width: 240px;
}

.gap-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-700);
}

.gap-item + .gap-item {
  border-top: 1px dashed var(--line);
}

.block-empty {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-400);
}

/* ---------------------------------------------------------------- 响应式 */

@media (max-width: 1100px) {
  .steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .steps {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
