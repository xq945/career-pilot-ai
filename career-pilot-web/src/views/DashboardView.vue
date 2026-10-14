<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChatDotRound, OfficeBuilding, Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { getDashboardSummary } from '@/api/dashboard'
import StateBlock from '@/components/StateBlock.vue'
import { useUserStore } from '@/stores/user'

/**
 * 仪表盘（《前端原型设计》§5.2，接口《API接口设计》9.1）。
 *
 * **整页只发一个请求**（GET /api/dashboard/summary）：统计卡、最近匹配、能力差距
 * 与「求职准备清单」六步的完成状态全部来自同一响应——六步由计数字段推导
 * （① 简历数>0 ② 简历分析数>0 ③ 岗位数>0 ④ 岗位分析数>过期数 ⑤ 匹配数>0
 * ⑥ 已完成面试数>0），不再逐条查询各模块的分析状态。
 *
 * 四态：加载与错误走 StateBlock（错误态带重试，单请求失败即整页错误）；
 * **全 0 数据不设独立空态**——统计卡显示 0，两个列表区块各给一句引导文案。
 */
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const loadError = ref('')
const summary = ref(null)

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

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    summary.value = await getDashboardSummary()
  }
  catch (error) {
    loadError.value = error.message
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

/* ---------------------------------------------------------------- 统计卡与脚注 */

const stats = computed(() => {
  const s = summary.value
  if (!s) {
    return []
  }
  return [
    { key: 'resume', label: '简历', value: s.resumeCount, unit: '份', foot: resumeFoot(s) },
    { key: 'job', label: '目标岗位', value: s.jobCount, unit: '个', foot: jobFoot(s) },
    // M11 起页面入口为「简历定向优化」：matchCount 计的是匹配记录数（每次优化都会写一条，
    // 智能体也可能产生），语义上即"围绕简历与岗位的分析次数"，字段名与口径不变
    { key: 'match', label: '简历优化', value: s.matchCount, unit: '次', foot: matchFoot(s) },
    { key: 'interview', label: '模拟面试', value: s.interviewCount, unit: '场', foot: interviewFoot(s) },
  ]
})

function resumeFoot(s) {
  if (s.resumeAnalyzedCount === 0) {
    return '暂无已完成分析'
  }
  return `${s.resumeAnalyzedCount} 份已完成 AI 分析`
}

function jobFoot(s) {
  if (s.jobCount === 0) {
    return '还没有录入岗位'
  }
  if (s.jobStaleCount > 0) {
    return `${s.jobStaleCount} 个岗位描述已更新`
  }
  return `${s.jobAnalyzedCount} 个已完成 AI 分析`
}

function matchFoot(s) {
  if (s.bestMatchScore === null) {
    return '暂无优化记录'
  }
  return `最高匹配分 ${s.bestMatchScore}`
}

function interviewFoot(s) {
  if (s.interviewOngoingCount > 0) {
    return `${s.interviewOngoingCount} 场进行中`
  }
  if (s.interviewCompletedCount > 0) {
    return `${s.interviewCompletedCount} 场已完成`
  }
  return '还没有面试记录'
}

/* ---------------------------------------------------------------- 最近任务（M13） */

const recentTasks = computed(() => summary.value?.recentTasks ?? [])

const formatTime = (iso) => dayjs(iso).format('MM-DD HH:mm')

/** 任务类型 → 标签文案、标签色与跳转目标（分析类跳对应分析页，优化 / 面试跳详情） */
const TASK_TYPES = {
  RESUME_ANALYSIS: {
    label: '简历分析',
    tag: 'primary',
    to: (task) => ({ name: 'resume-analysis', params: { id: task.refId } }),
  },
  JOB_ANALYSIS: {
    label: '岗位分析',
    tag: 'primary',
    to: (task) => ({ name: 'job-analysis', params: { id: task.refId } }),
  },
  OPTIMIZATION: {
    label: '简历优化',
    tag: 'success',
    to: (task) => ({ name: 'optimization-detail', params: { id: task.refId } }),
  },
  INTERVIEW: {
    label: '模拟面试',
    tag: 'warning',
    to: (task) => ({ name: 'interview-session', params: { id: task.refId } }),
  },
}

const taskMeta = (task) => TASK_TYPES[task.type] ?? { label: task.type, tag: 'info', to: null }

function openTask(task) {
  const meta = taskMeta(task)
  if (meta.to) {
    router.push(meta.to(task))
  }
}

/* ---------------------------------------------------------------- 能力差距概览 */

const gaps = computed(() => summary.value?.topGaps ?? [])

/* ---------------------------------------------------------------- 求职准备清单（六步由计数推导） */

const checklist = computed(() => {
  const s = summary.value
  if (!s) {
    return []
  }
  return [
    { title: '上传第一份简历', done: s.resumeCount > 0, action: '去上传', to: { name: 'resumes' } },
    { title: '完成简历 AI 分析', done: s.resumeAnalyzedCount > 0, action: '去分析', to: { name: 'resumes' } },
    { title: '录入目标岗位', done: s.jobCount > 0, action: '去录入', to: { name: 'jobs' } },
    {
      title: '完成岗位分析',
      // 「存在未过期的分析」才算完成（jobStaleCount ⊆ jobAnalyzedCount，§9.1）
      done: s.jobAnalyzedCount > s.jobStaleCount,
      action: '去分析',
      to: { name: 'jobs' },
      meta: s.jobStaleCount > 0 ? `${s.jobStaleCount} 个岗位描述已更新，需重新分析` : '',
    },
    // 判定仍用 matchCount（接口无 optimizationCount；优化流程每次都会写入一条匹配记录）
    { title: '生成优化报告', done: s.matchCount > 0, action: '去优化', to: { name: 'optimizations' } },
    { title: '完成一次模拟面试', done: s.interviewCompletedCount > 0, action: '去练习', to: { name: 'interviews' } },
  ]
})

const doneCount = computed(() => checklist.value.filter((item) => item.done).length)
const donePercent = computed(() => Math.round((doneCount.value / 6) * 100))
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ greeting }}，{{ userStore.displayName }}</h1>
      </div>
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <!-- 统计卡 ×4：值取计数字段，脚注给各自的下一步提示 -->
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
          </div>
        </div>
      </div>

      <div class="columns">
        <div class="column">
          <!-- 最近任务（M13：四类动态混合时间线，替代原「最近匹配记录」卡） -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>最近任务</h2>
                <span class="card__sub">按时间倒序 · 点击进入</span>
              </div>
            </template>

            <p v-if="recentTasks.length === 0" class="block-empty">
              还没有任务记录。上传简历并完成分析、录入岗位，或发起一次简历优化，
              这里会按时间显示最近的动态。
            </p>
            <div v-else class="task-list">
              <div
                v-for="(task, index) in recentTasks"
                :key="`${task.type}-${task.refId}-${index}`"
                class="task-row"
                @click="openTask(task)"
              >
                <el-tag :type="taskMeta(task).tag" size="small" effect="light">
                  {{ taskMeta(task).label }}
                </el-tag>
                <div class="task-row__title">
                  {{ task.title }}
                </div>
                <span class="task-row__time">{{ formatTime(task.happenedAt) }}</span>
              </div>
            </div>
          </el-card>

          <!-- 能力差距概览（missing 在前、partial 在后，最多 3 条） -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>能力差距概览</h2>
                <span class="card__sub">来自最近一次匹配</span>
              </div>
            </template>

            <p v-if="gaps.length === 0" class="block-empty">
              完成一次简历优化后，这里会显示最近一份匹配分析里的能力差距。
            </p>
            <template v-else>
              <el-alert class="gap-alert" type="warning" :closable="false" show-icon>
                以下项在简历中<strong>未找到证据</strong>，不代表你一定不具备该能力，建议核对后补充。
              </el-alert>
              <div v-for="(gap, index) in gaps" :key="index" class="gap-item">
                <el-tag :type="gap.type === 'MISSING' ? 'danger' : 'warning'" size="small" effect="light">
                  {{ gap.type === 'MISSING' ? '未体现' : '部分匹配' }}
                </el-tag>
                <span>{{ gap.text }}</span>
              </div>
            </template>
          </el-card>
        </div>

        <div class="column">
          <!-- 求职准备清单：六步由计数字段推导 -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>求职准备清单</h2>
              </div>
            </template>

            <div class="progress-row">
              <span class="progress-row__muted">已完成 {{ doneCount }} / 6</span>
              <span class="progress-row__strong">{{ donePercent }}%</span>
            </div>
            <el-progress class="progress" :percentage="donePercent" :show-text="false" />

            <div class="checklist">
              <div v-for="(item, index) in checklist" :key="item.title" class="checklist__item">
                <span class="checklist__no" :class="{ 'checklist__no--done': item.done }">
                  {{ item.done ? '✓' : index + 1 }}
                </span>
                <div class="checklist__main">
                  <div class="checklist__title">
                    {{ item.title }}
                  </div>
                  <div v-if="item.meta" class="checklist__meta">
                    {{ item.meta }}
                  </div>
                </div>
                <el-button size="small" :type="item.done ? undefined : 'primary'" @click="router.push(item.to)">
                  {{ item.done ? '查看' : item.action }}
                </el-button>
              </div>
            </div>
          </el-card>
        </div>
      </div>
    </StateBlock>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.page-head__desc {
  font-size: 13px;
  color: var(--ink-500);
  margin-top: 4px;
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

/* ---------------------------------------------------------------- 两栏布局与卡片 */

/* 左栏自适应填满，右栏固定宽度（与各报告页右栏同为 300px） */
.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.card {
  border-radius: var(--radius);
  margin-bottom: 16px;
}

.card :deep(.el-card__header) {
  padding: 14px 18px;
}

.card :deep(.el-card__body) {
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

.block-empty {
  padding: 6px 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-400);
}

/* ---------------------------------------------------------------- 最近任务（M13） */

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.task-row + .task-row {
  border-top: 1px solid var(--line);
}

.task-row:hover {
  background: var(--bg);
}

.task-row__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row__time {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--ink-400);
}

/* ---------------------------------------------------------------- 能力差距 */

.gap-alert {
  margin-bottom: 12px;
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

/* ---------------------------------------------------------------- 准备清单 */

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
  margin-bottom: 14px;
}

.checklist__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}

.checklist__item + .checklist__item {
  border-top: 1px solid var(--line);
}

.checklist__no {
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

.checklist__no--done {
  background: var(--brand-50);
  color: var(--brand-600);
  border-color: transparent;
}

.checklist__main {
  flex: 1;
  min-width: 0;
}

.checklist__title {
  font-size: 13px;
  color: var(--ink-900);
}

.checklist__meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--warn);
}

/* ---------------------------------------------------------------- 快捷入口 */

.quick-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  cursor: pointer;
  color: var(--ink-700);
}

.quick-entry + .quick-entry {
  border-top: 1px solid var(--line);
}

.quick-entry__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-900);
}

.quick-entry__meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink-400);
}

/* 窄屏：统计卡降为两列，两栏堆叠（右栏落到下方，先清单后快捷入口） */
@media (max-width: 1100px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
