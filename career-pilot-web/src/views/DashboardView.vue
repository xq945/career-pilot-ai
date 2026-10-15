<script setup>
import { computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { Aim, Briefcase, ChatLineSquare, Document, Upload } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { getDashboardSummary } from '@/api/dashboard'
import { listInterviews } from '@/api/interview'
import { listOptimizations } from '@/api/optimization'
import { listResumes } from '@/api/resume'
import AnalysisStateTag from '@/components/AnalysisStateTag.vue'
import DashboardWorkflowCard from '@/components/dashboard/DashboardWorkflowCard.vue'
import RecentBlock from '@/components/dashboard/RecentBlock.vue'
import { useUserStore } from '@/stores/user'

/**
 * 工作台（《前端原型设计》§5.2，接口《API接口设计》9.1）。
 *
 * 以 **AI 求职工作流**为中心：欢迎区 + 快捷操作 → 四张统计卡 → 核心工作流
 * （选简历 → 选岗位 → 匹配分析 → 简历优化 → AI 面试）→ 四组最近记录。
 *
 * **数据获取为四个并行请求**，非整页单请求：
 * - `GET /api/dashboard/summary` —— 统计卡计数、最近匹配记录、能力差距；
 * - `GET /api/resumes?size=5` / `GET /api/optimizations?size=5` / `GET /api/interviews?size=5`
 *   —— 三组最近记录（同时供工作流卡推导步骤状态）。
 * 四者相互独立、**分区容错**：任一失败只让对应区块进入错误态并给出重试，其余照常渲染。
 * 后端未新增任何接口。
 *
 * ⚠️ 统计卡区**恒定渲染 4 个 `.stat` 节点**（加载中显示占位、失败显示「—」+ 重试），
 * 不随请求状态增删节点——e2e 依赖节点数量。
 */
const RECENT_SIZE = 5

const router = useRouter()
const userStore = useUserStore()

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) {
    return '凌晨好'
  }
  if (hour < 12) {
    return '早上好'
  }
  if (hour < 18) {
    return '下午好'
  }
  return '晚上好'
})

/* ---------------------------------------------------------------- 数据（四个独立区块） */

const summary = reactive({ loading: false, error: '', data: null })
const resumes = reactive({ loading: false, error: '', records: [], total: 0 })
const optimizations = reactive({ loading: false, error: '', records: [] })
const interviews = reactive({ loading: false, error: '', records: [] })

async function loadSummary() {
  summary.loading = true
  summary.error = ''
  try {
    summary.data = await getDashboardSummary()
  }
  catch (error) {
    summary.error = error.message || '加载失败，请稍后重试'
  }
  finally {
    summary.loading = false
  }
}

async function loadResumes() {
  resumes.loading = true
  resumes.error = ''
  try {
    const data = await listResumes({ page: 1, size: RECENT_SIZE })
    resumes.records = data.records
    resumes.total = data.total
  }
  catch (error) {
    resumes.error = error.message || '加载失败，请稍后重试'
  }
  finally {
    resumes.loading = false
  }
}

async function loadOptimizations() {
  optimizations.loading = true
  optimizations.error = ''
  try {
    const data = await listOptimizations({ page: 1, size: RECENT_SIZE })
    optimizations.records = data.records
  }
  catch (error) {
    optimizations.error = error.message || '加载失败，请稍后重试'
  }
  finally {
    optimizations.loading = false
  }
}

async function loadInterviews() {
  interviews.loading = true
  interviews.error = ''
  try {
    const data = await listInterviews({ page: 1, size: RECENT_SIZE })
    interviews.records = data.records
  }
  catch (error) {
    interviews.error = error.message || '加载失败，请稍后重试'
  }
  finally {
    interviews.loading = false
  }
}

function loadAll() {
  return Promise.allSettled([loadSummary(), loadResumes(), loadOptimizations(), loadInterviews()])
}

/** 工作流任务到达终态后刷新受影响的区块（简历不受影响，不重拉） */
function reloadAfterTask() {
  return Promise.allSettled([loadSummary(), loadOptimizations(), loadInterviews()])
}

onMounted(loadAll)

/* ---------------------------------------------------------------- 快捷操作 */

const quickActions = [
  { key: 'resume', text: '上传简历', icon: Upload, to: { name: 'resumes', query: { upload: '1' } } },
  { key: 'match', text: '新建岗位匹配任务', icon: Aim, to: { name: 'optimizations', query: { create: '1' } } },
  { key: 'interview', text: '开始 AI 面试', icon: ChatLineSquare, to: { name: 'interviews' } },
]

/* ---------------------------------------------------------------- 统计卡 */

const STAT_KEYS = [
  { key: 'resume', label: '我的简历', unit: '份' },
  { key: 'job', label: '已分析岗位', unit: '个' },
  { key: 'match', label: '匹配分析', unit: '次' },
  { key: 'interview', label: 'AI 面试完成', unit: '场' },
]

const stats = computed(() => {
  const s = summary.data
  if (!s) {
    // 加载中与加载失败同样渲染四张卡；值位给占位、脚注说明状态
    return STAT_KEYS.map((item) => ({
      ...item,
      value: summary.error ? '—' : '…',
      foot: summary.error ? '数据加载失败，可重试' : '加载中…',
    }))
  }
  return [
    { ...STAT_KEYS[0], value: s.resumeCount, foot: resumeFoot(s) },
    { ...STAT_KEYS[1], value: s.jobAnalyzedCount, foot: jobFoot(s) },
    { ...STAT_KEYS[2], value: s.matchCount, foot: matchFoot(s) },
    { ...STAT_KEYS[3], value: s.interviewCompletedCount, foot: interviewFoot(s) },
  ]
})

function resumeFoot(s) {
  if (s.resumeCount === 0) {
    return '还没有简历，上传第一份开始'
  }
  if (s.resumeAnalyzedCount < s.resumeCount) {
    return `${s.resumeAnalyzedCount} 份已完成 AI 分析，${s.resumeCount - s.resumeAnalyzedCount} 份待分析`
  }
  return `${s.resumeAnalyzedCount} 份已完成 AI 分析`
}

function jobFoot(s) {
  if (s.jobCount === 0) {
    return '还没有录入岗位'
  }
  if (s.jobStaleCount > 0) {
    return `${s.jobStaleCount} 个岗位描述已更新，需重新分析`
  }
  if (s.jobAnalyzedCount < s.jobCount) {
    return `共 ${s.jobCount} 个岗位，${s.jobCount - s.jobAnalyzedCount} 个待分析`
  }
  return `共 ${s.jobCount} 个岗位`
}

function matchFoot(s) {
  if (s.bestMatchScore === null) {
    return '还没有匹配记录'
  }
  return `最高匹配分 ${s.bestMatchScore}`
}

function interviewFoot(s) {
  if (s.interviewOngoingCount > 0) {
    return `${s.interviewOngoingCount} 场进行中`
  }
  if (s.interviewCount > 0) {
    return `共 ${s.interviewCount} 场面试`
  }
  return '还没有面试记录'
}

/* ---------------------------------------------------------------- 最近记录 */

const formatTime = (iso) => dayjs(iso).format('MM-DD HH:mm')

/** 分数色阶（与《前端原型设计》§5.7 一致：≥80 绿、60–79 蓝、<60 橙、null 中性） */
function scoreType(score) {
  if (score === null || score === undefined) {
    return 'info'
  }
  if (score >= 80) {
    return 'success'
  }
  if (score >= 60) {
    return 'primary'
  }
  return 'warning'
}

/** 分数去除尾零（76.50 → 76.5）；分数由后端计算，前端不加工 */
const displayScore = (score) => (score === null || score === undefined ? '待评估' : Number(score))

/** 优化任务状态标签（与 OptimizationsView 同口径） */
const TASK_TAG_LABELS = { PENDING: '排队中', PROCESSING: '生成中', FAILED: '生成失败' }

const taskTagText = (status) => TASK_TAG_LABELS[status] ?? status

function taskTagType(status) {
  if (status === 'FAILED') {
    return 'danger'
  }
  if (status === 'PENDING' || status === 'PROCESSING') {
    return 'primary'
  }
  return 'info'
}

/** 面试状态标签（与 InterviewsView 同口径） */
function statusTag(item) {
  if (item.status === 1) {
    return { type: 'success', text: '已完成' }
  }
  if (item.status === 2) {
    return { type: 'info', text: '已取消' }
  }
  return { type: 'primary', text: `进行中 · ${item.answeredCount}/${item.generatedCount}` }
}

const recentMatches = computed(() => summary.data?.recentMatches ?? [])

/* ---------------------------------------------------------------- 跳转 */

/** 未分析的简历直接带 `auto=1` 进入分析页（用户主动点击，与 ResourcePicker 同口径） */
function openResume(item) {
  const location = { name: 'resume-analysis', params: { id: item.id } }
  if (!item.analyzed) {
    location.query = { auto: '1' }
  }
  router.push(location)
}

/**
 * 匹配记录跳岗位分析页：`DashboardRecentMatch` 不含 optimizationId，
 * 无法直达优化工作台；岗位被删除时目标页会给出错误态。
 */
function openMatch(item) {
  router.push({ name: 'job-analysis', params: { id: item.jobId } })
}

function openOptimization(item) {
  router.push({ name: 'optimization-detail', params: { id: item.id } })
}

function openInterview(item) {
  if (item.status === 0) {
    router.push({ name: 'interview-session', params: { id: item.id } })
    return
  }
  router.push({ name: 'interview-report', params: { id: item.id } })
}
</script>

<template>
  <div>
    <!-- 欢迎区：个性化问候 + 三个连真实业务的快捷操作 -->
    <div class="welcome">
      <div class="welcome__text">
        <h1>{{ greeting }}，{{ userStore.displayName }}</h1>
        <p class="welcome__desc">
          这里是你的 AI 求职工作台：从简历到面试，一条链路走完。
        </p>
      </div>
      <div class="welcome__actions">
        <el-button
          v-for="(action, index) in quickActions"
          :key="action.key"
          :type="index === 0 ? 'primary' : 'default'"
          :icon="action.icon"
          @click="router.push(action.to)"
        >
          {{ action.text }}
        </el-button>
      </div>
    </div>

    <!-- 数据概览：恒定四张卡；summary 失败时值位显「—」并给出重试 -->
    <div class="stats">
      <div v-for="item in stats" :key="item.key" class="stat">
        <div class="stat__label">
          {{ item.label }}
        </div>
        <div class="stat__value">
          {{ item.value }}<small>{{ item.unit }}</small>
        </div>
        <div class="stat__foot">
          {{ item.foot }}
          <el-button
            v-if="summary.error"
            class="stat__retry"
            link
            type="primary"
            size="small"
            @click="loadSummary"
          >
            重试
          </el-button>
        </div>
      </div>
    </div>

    <!-- 核心 AI 求职工作流：③④ 共享同一次启动，任务在服务端异步执行 -->
    <DashboardWorkflowCard
      :summary="summary.data"
      :optimizations="optimizations.records"
      :interviews="interviews.records"
      :loading="optimizations.loading"
      :error="optimizations.error"
      @changed="reloadAfterTask"
      @retry="loadOptimizations"
    />

    <!-- 最近记录：四组独立区块，各按真实业务时间倒序 -->
    <div class="recents">
      <RecentBlock
        title="最近添加的简历"
        :sub="resumes.total > 0 ? `按上传时间 · 共 ${resumes.total} 份` : '按上传时间'"
        :loading="resumes.loading"
        :error="resumes.error"
        :empty="resumes.records.length === 0"
        empty-title="还没有简历"
        empty-text="上传一份 PDF、DOCX、DOC、HTML 或 TXT 简历，系统会自动提取文本用于分析。"
        empty-action-text="上传简历"
        :more-to="{ name: 'resumes' }"
        @retry="loadResumes"
        @action="router.push({ name: 'resumes', query: { upload: '1' } })"
      >
        <div
          v-for="item in resumes.records"
          :key="item.id"
          class="recent-row"
          @click="openResume(item)"
        >
          <el-icon class="recent-row__icon" :size="16"><Document /></el-icon>
          <div class="recent-row__main">
            <div class="recent-row__title">
              {{ item.name }}
            </div>
            <div class="recent-row__meta">
              {{ item.fileType }} · {{ formatTime(item.createdAt) }}
            </div>
          </div>
          <AnalysisStateTag :analyzed="item.analyzed" />
        </div>
      </RecentBlock>

      <RecentBlock
        title="最近匹配的岗位"
        sub="按匹配时间"
        :loading="summary.loading"
        :error="summary.error"
        :empty="recentMatches.length === 0"
        empty-title="还没有匹配记录"
        empty-text="在上方工作流中选择简历与岗位并启动，这里会显示最近的匹配结果。"
        empty-action-text="去做一次匹配"
        :more-to="{ name: 'jobs' }"
        @retry="loadSummary"
        @action="router.push({ name: 'optimizations', query: { create: '1' } })"
      >
        <div
          v-for="item in recentMatches"
          :key="item.id"
          class="recent-row"
          @click="openMatch(item)"
        >
          <el-icon class="recent-row__icon" :size="16"><Briefcase /></el-icon>
          <div class="recent-row__main">
            <div class="recent-row__title">
              {{ item.jobName }}
            </div>
            <div class="recent-row__meta">
              <template v-if="item.companyName">{{ item.companyName }} · </template>
              「{{ item.resumeName }}」· {{ formatTime(item.createdAt) }}
            </div>
          </div>
          <el-tag :type="scoreType(item.matchScore)" size="small" effect="light">
            {{ Number(item.matchScore) }}
          </el-tag>
        </div>
      </RecentBlock>

      <RecentBlock
        title="最近的简历优化任务"
        sub="按创建时间"
        :loading="optimizations.loading"
        :error="optimizations.error"
        :empty="optimizations.records.length === 0"
        empty-title="还没有优化记录"
        empty-text="选择一份已分析的简历与一个目标岗位，系统会先做匹配分析，再按岗位要求改写简历。"
        empty-action-text="新建简历优化"
        :more-to="{ name: 'optimizations' }"
        @retry="loadOptimizations"
        @action="router.push({ name: 'optimizations', query: { create: '1' } })"
      >
        <div
          v-for="item in optimizations.records"
          :key="item.id"
          class="recent-row"
          @click="openOptimization(item)"
        >
          <el-icon class="recent-row__icon" :size="16"><Aim /></el-icon>
          <div class="recent-row__main">
            <div class="recent-row__title">
              <span class="recent-row__name">{{ item.jobName }}</span>
              <template v-if="item.status === 'SUCCESS'">
                <el-tag :type="scoreType(item.matchScore)" size="small" effect="light">
                  {{ displayScore(item.matchScore) }}
                </el-tag>
                <span class="recent-row__arrow">→</span>
                <el-tag :type="scoreType(item.scoreAfter)" size="small" effect="light">
                  {{ displayScore(item.scoreAfter) }}
                </el-tag>
              </template>
              <el-tag v-else :type="taskTagType(item.status)" size="small" effect="light">
                {{ taskTagText(item.status) }}
              </el-tag>
            </div>
            <div class="recent-row__meta">
              「{{ item.resumeName }}」· v{{ item.versionNo }} · {{ formatTime(item.createdAt) }}
            </div>
          </div>
        </div>
      </RecentBlock>

      <RecentBlock
        title="最近的 AI 面试记录"
        sub="按创建时间"
        :loading="interviews.loading"
        :error="interviews.error"
        :empty="interviews.records.length === 0"
        empty-title="还没有面试记录"
        empty-text="按目标岗位生成面试题并作答，AI 会逐题评价并给出总评报告。"
        empty-action-text="开始 AI 面试"
        :more-to="{ name: 'interviews' }"
        @retry="loadInterviews"
        @action="router.push({ name: 'interviews' })"
      >
        <div
          v-for="item in interviews.records"
          :key="item.id"
          class="recent-row"
          @click="openInterview(item)"
        >
          <el-icon class="recent-row__icon" :size="16"><ChatLineSquare /></el-icon>
          <div class="recent-row__main">
            <div class="recent-row__title">
              <span class="recent-row__name">{{ item.title }}</span>
              <el-tag :type="statusTag(item).type" size="small" effect="light">
                {{ statusTag(item).text }}
              </el-tag>
              <el-tag
                v-if="item.status === 1 && item.totalScore !== null"
                type="success"
                size="small"
                effect="plain"
              >
                {{ displayScore(item.totalScore) }} 分
              </el-tag>
            </div>
            <div class="recent-row__meta">
              {{ item.jobName }} · {{ formatTime(item.createdAt) }}
            </div>
          </div>
        </div>
      </RecentBlock>
    </div>
  </div>
</template>

<style scoped>
/* ---------------------------------------------------------------- 欢迎区 */

.welcome {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.welcome__text h1 {
  font-size: 22px;
  margin-bottom: 4px;
}

.welcome__desc {
  font-size: 13px;
  color: var(--ink-500);
}

.welcome__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* ---------------------------------------------------------------- 统计卡 */

/* 四等分铺满整行 */
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.stat {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
}

.stat__label {
  font-size: 13px;
  color: var(--ink-500);
}

.stat__value {
  margin-top: 8px;
  font-size: 26px;
  font-weight: 600;
  color: var(--ink-900);
  line-height: 1.2;
}

.stat__value small {
  margin-left: 3px;
  font-size: 13px;
  font-weight: 400;
  color: var(--ink-400);
}

.stat__foot {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-400);
}

.stat__retry {
  vertical-align: baseline;
}

/* ---------------------------------------------------------------- 最近记录 */

/* 两块一行；行样式写在此处（scoped 样式不作用于 RecentBlock 的插槽内容） */
.recents {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.recent-row + .recent-row {
  border-top: 1px solid var(--line);
}

.recent-row:hover {
  background: var(--bg);
}

.recent-row__icon {
  flex: 0 0 auto;
  color: var(--ink-400);
}

.recent-row__main {
  flex: 1;
  min-width: 0;
}

.recent-row__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-900);
}

.recent-row__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-row__arrow {
  color: var(--ink-400);
  font-size: 12px;
}

.recent-row__meta {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- 响应式 */

@media (max-width: 1100px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .recents {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .welcome__actions {
    width: 100%;
  }
}
</style>
