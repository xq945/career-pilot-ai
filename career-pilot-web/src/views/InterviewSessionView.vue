<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Check } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'

import { categoryLabel, getInterview, submitAnswer, TYPE_LABELS } from '@/api/interview'
import AiWaiting from '@/components/AiWaiting.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 模拟面试答题（《前端原型设计》§5.10，接口《API接口设计》§7.2/§7.3）。
 *
 * 三栏结构：右侧题号导航（含得分）+ 左侧答题区 + 底部上一题/下一题。
 * 单题三态：未作答 / 评价中 / 已评价；重复提交前弹确认（三条文案），
 * 得分以最后一次为准，**重答后总分即时重算**（已完成会话同样允许）。
 *
 * 评价失败（50200/50201）时**不清空输入**：错误就地显示、同题重试（§7.2 失败不入库）。
 * 支持 `?q=N` 定位（报告页「去作答」的落点）。
 */
const route = useRoute()
const router = useRouter()
const sessionId = Number(route.params.id)

const loading = ref(true)
const loadError = ref('')
const session = ref(null)

/* ---------------------------------------------------------------- 本地状态 */

/** 当前题索引（0 起） */
const currentIndex = ref(0)

/** 每题草稿：questionId → 文本（提交失败时保留，供原样重试） */
const drafts = reactive({})

/** 正在评价的题目 id（null 表示无评价进行中） */
const evaluatingQuestionId = ref(null)

/** 当前题的提交错误 { code, message } */
const submitError = ref(null)

const questions = computed(() => session.value?.questions ?? [])
const current = computed(() => questions.value[currentIndex.value] ?? null)

const formatTime = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—')

/** 分数展示去掉尾零（76.50 → 76.5）；分数本身由后端计算，前端不加工 */
const displayScore = (score) => Number(score)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    session.value = await getInterview(sessionId)
    for (const question of session.value.questions) {
      drafts[question.id] = question.answer ?? ''
    }
    applyQueryIndex()
  }
  catch (error) {
    loadError.value = error.message || '加载失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

/** `?q=N` 定位到第 N 题（1 起），越界忽略 */
function applyQueryIndex() {
  const index = Number(route.query.q)
  if (Number.isInteger(index) && index >= 1 && index <= questions.value.length) {
    currentIndex.value = index - 1
  }
}

onMounted(load)

/* ---------------------------------------------------------------- 答题与评价 */

const answeredCount = computed(() => session.value?.answeredCount ?? 0)
const generatedCount = computed(() => session.value?.generatedCount ?? 0)
const progressPercent = computed(() =>
  generatedCount.value === 0 ? 0 : Math.round((answeredCount.value / generatedCount.value) * 100),
)

const progressText = computed(
  () => `已答 ${answeredCount.value} / ${generatedCount.value} 题 · 全部作答后生成总分`,
)

/** 当前题是否正在评价 */
const evaluatingCurrent = computed(
  () => current.value !== null && evaluatingQuestionId.value === current.value.id,
)

/** 当前题是否已作答（有回答即有评价，不存在中间态） */
const currentAnswered = computed(() => current.value?.answer !== null && current.value?.answer !== undefined)

/** 草稿是否与已提交回答不同（决定按钮文案：提交 / 更新） */
const currentDraftChanged = computed(() => {
  if (!current.value) {
    return false
  }
  return (drafts[current.value.id] ?? '') !== (current.value.answer ?? '')
})

const submitButtonText = computed(() => (currentAnswered.value ? '更新回答' : '提交回答'))

function goto(index) {
  if (evaluatingQuestionId.value !== null) {
    return
  }
  currentIndex.value = index
  submitError.value = null
}

async function submit() {
  const question = current.value
  if (!question || evaluatingCurrent.value) {
    return
  }
  const answer = (drafts[question.id] ?? '').trim()
  if (!answer) {
    ElMessage.warning('请先输入回答内容')
    return
  }

  // 覆盖提交前确认（原型 §5.10：三条文案，V2.0 修订为「即时重算」）
  if (question.answer !== null && question.answer !== undefined) {
    try {
      await ElMessageBox.confirm(
        `覆盖后，该题旧回答与旧评价将被替换；本题得分以最后一次为准（当前 ${displayScore(question.score)} 分）。`
        + '重答后总分即时重算，已完成会话同样允许。',
        '确认更新回答？',
        { confirmButtonText: '更新回答', cancelButtonText: '取消', type: 'warning' },
      )
    }
    catch {
      return
    }
  }

  const wasUnanswered = question.answer === null || question.answer === undefined
  evaluatingQuestionId.value = question.id
  submitError.value = null
  try {
    const result = await submitAnswer(sessionId, question.id, drafts[question.id])
    // 合并本次评价（回答与评价字段同时更新，与后端的「同时写入」不变量一致）
    question.answer = drafts[question.id]
    question.score = result.score
    question.analysis = result.analysis
    question.referenceAnswer = result.referenceAnswer
    question.suggestions = result.suggestions
    if (wasUnanswered) {
      session.value.answeredCount += 1
    }
    if (answeredCount.value === generatedCount.value) {
      ElMessage.success('全部题目已作答，总分与总评已生成，可查看报告')
    }
  }
  catch (error) {
    // 失败不写入任何数据：草稿原样保留，可直接重试
    submitError.value = { code: error.code, message: error.message || '评价失败，请稍后重试' }
  }
  finally {
    evaluatingQuestionId.value = null
  }
}

const submitErrorText = computed(() => {
  if (!submitError.value) {
    return ''
  }
  if (submitError.value.code === 50200 || submitError.value.code === 50201) {
    return `${submitError.value.message}（你的回答已保留，可以直接重试）`
  }
  return submitError.value.message
})

/* ---------------------------------------------------------------- 右栏导航 */

/** 题号导航项 */
function navigationTag(index) {
  const question = questions.value[index]
  return question.answer === null || question.answer === undefined ? `${index + 1}` : '✓'
}

/** 已答题目得分摘要（仅展示用；会话未完成时后端不返回 totalScore，不与之混用） */
const answeredScores = computed(() =>
  questions.value.filter((question) => question.answer !== null && question.answer !== undefined)
    .map((question) => Number(question.score)),
)

const averageScore = computed(() => {
  if (answeredScores.value.length === 0) {
    return null
  }
  const sum = answeredScores.value.reduce((acc, value) => acc + value, 0)
  return Math.round((sum / answeredScores.value.length) * 100) / 100
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <el-button link :icon="ArrowLeft" class="page-head__back" @click="router.push('/interviews')">
          返回面试列表
        </el-button>
        <h1>{{ session?.title ?? '模拟面试' }}</h1>
        <p v-if="session" class="page-head__desc">
          {{ session.jobName }}<template v-if="session.companyName"> · {{ session.companyName }}</template>
          · {{ TYPE_LABELS[session.questionType] ?? session.questionType }}
        </p>
        <!-- M12：来源展示（源资源被逻辑删除后仍显示） -->
        <p v-if="session?.resumeName" class="page-head__desc page-head__source">
          来源：<template v-if="session.optimizationVersionNo">优化稿 v{{ session.optimizationVersionNo }} · </template>{{ session.resumeName }}
        </p>
      </div>
      <el-button
        v-if="session"
        @click="router.push({ name: 'interview-report', params: { id: sessionId } })"
      >
        查看报告
      </el-button>
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <div v-if="session" class="layout">
        <div class="layout__main">
          <!-- 进度 -->
          <el-card shadow="never" class="card">
            <div class="progress">
              <div class="progress__text">{{ progressText }}</div>
              <el-progress :percentage="progressPercent" :show-text="false" />
            </div>
          </el-card>

          <!-- 当前题 -->
          <el-card v-if="current" shadow="never" class="card question-card">
            <template #header>
              <div class="card__head">
                <h2>第 {{ currentIndex + 1 }} 题</h2>
                <el-tag size="small" effect="plain">{{ categoryLabel(current.questionCategory) }}</el-tag>
              </div>
            </template>

            <p class="question-card__text">{{ current.question }}</p>

            <!-- 我的回答 -->
            <div class="answer-block">
              <h3 class="answer-block__title">我的回答</h3>
              <el-input
                v-model="drafts[current.id]"
                type="textarea"
                :rows="7"
                maxlength="5000"
                show-word-limit
                placeholder="写下你的回答要点，AI 会给出手评分与改进建议"
                :disabled="evaluatingCurrent"
              />
              <p v-if="currentAnswered" class="answer-block__note">
                重新提交会覆盖上一次的回答与评价，得分以最后一次为准。
              </p>
              <div class="answer-block__actions">
                <el-button
                  type="primary"
                  :loading="evaluatingCurrent"
                  :disabled="evaluatingQuestionId !== null"
                  @click="submit"
                >
                  {{ submitButtonText }}
                </el-button>
              </div>
            </div>

            <!-- 评价中 -->
            <AiWaiting
              v-if="evaluatingCurrent"
              title="AI 正在批改你的回答…"
              hint="评价通常需要 10–30 秒；如果这是最后一题，还会额外生成总评，可能更久。"
              leave-hint="评价失败时会保留你的回答，可直接重试。"
            />

            <!-- 已评价 -->
            <div v-else-if="currentAnswered" class="review">
              <div class="review__score">
                <span class="review__num">{{ displayScore(current.score) }}</span>
                <span class="review__unit">分</span>
                <el-progress
                  class="review__bar"
                  :percentage="Math.min(Math.max(Number(current.score), 0), 100)"
                  :show-text="false"
                />
              </div>

              <div v-if="current.analysis" class="review__section">
                <h3>AI 点评</h3>
                <p>{{ current.analysis }}</p>
              </div>

              <div v-if="current.referenceAnswer" class="review__section">
                <h3>参考答案</h3>
                <p class="review__pre">{{ current.referenceAnswer }}</p>
              </div>

              <div v-if="current.suggestions?.length" class="review__section">
                <h3>改进建议</h3>
                <ul class="review__list">
                  <li v-for="(item, index) in current.suggestions" :key="index">{{ item }}</li>
                </ul>
              </div>

              <p class="review__foot">评分与点评由 AI 生成，仅供参考，不代表真实面试结果。</p>
            </div>

            <el-alert
              v-if="submitError"
              class="tip"
              type="error"
              :closable="false"
              show-icon
            >
              {{ submitErrorText }}
            </el-alert>
          </el-card>

          <!-- 上一题 / 下一题 -->
          <div v-if="questions.length > 1" class="pager">
            <el-button
              :icon="ArrowLeft"
              :disabled="currentIndex === 0 || evaluatingQuestionId !== null"
              @click="goto(currentIndex - 1)"
            >
              上一题
            </el-button>
            <span class="pager__text">{{ currentIndex + 1 }} / {{ questions.length }}</span>
            <el-button
              :disabled="currentIndex === questions.length - 1 || evaluatingQuestionId !== null"
              @click="goto(currentIndex + 1)"
            >
              下一题
              <el-icon class="el-icon--right"><ArrowRight /></el-icon>
            </el-button>
          </div>
        </div>

        <!-- 右栏：题号导航 -->
        <aside class="layout__side">
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>题目导航</h2>
              </div>
            </template>

            <div class="nav">
              <button
                v-for="(question, index) in questions"
                :key="question.id"
                type="button"
                class="nav__item"
                :class="{ 'nav__item--active': index === currentIndex, 'nav__item--done': question.answer !== null && question.answer !== undefined }"
                @click="goto(index)"
              >
                <span class="nav__no">
                  <el-icon v-if="question.answer !== null && question.answer !== undefined"><Check /></el-icon>
                  <template v-else>{{ navigationTag(index) }}</template>
                </span>
                <span class="nav__text">{{ question.question }}</span>
                <span v-if="question.score !== null && question.score !== undefined" class="nav__score">
                  {{ displayScore(question.score) }}
                </span>
              </button>
            </div>

            <div class="nav__foot">
              已答 {{ answeredCount }} 题<template v-if="averageScore !== null"> · 平均 {{ averageScore }} 分</template>
            </div>
          </el-card>

          <el-card shadow="never" class="card">
            <div class="hint">
              <p>答题提示</p>
              <ul>
                <li>先讲清思路与要点，再展开细节</li>
                <li>可以结合项目经历举例说明</li>
                <li>提交后 AI 会给出得分、点评与参考答案</li>
              </ul>
            </div>
          </el-card>
        </aside>
      </div>
    </StateBlock>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-head__back {
  margin-bottom: 4px;
}

.page-head h1 {
  font-size: 22px;
  margin-bottom: 4px;
}

.page-head__desc {
  font-size: 13px;
  color: var(--ink-500);
}

.page-head__source {
  margin-top: 2px;
  color: var(--ink-400);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.layout__main {
  min-width: 0;
}

.layout__side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  border-radius: var(--radius);
}

.card + .card {
  margin-top: 16px;
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
}

.card__head h2 {
  font-size: 17px;
}

/* ---- 进度 ---- */
.progress__text {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--ink-500);
}

/* ---- 题目 ---- */
.question-card__text {
  font-size: 15px;
  line-height: 1.8;
  color: var(--ink-900);
  margin-bottom: 18px;
}

.answer-block__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 8px;
}

.answer-block__note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-400);
}

.answer-block__actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

/* ---- 评价 ---- */
.review {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

.review__score {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 14px;
}

.review__num {
  font-size: 32px;
  font-weight: 700;
  color: var(--brand-600);
}

.review__unit {
  font-size: 13px;
  color: var(--ink-400);
}

.review__bar {
  flex: 1;
  margin-left: 10px;
}

.review__section {
  margin-bottom: 14px;
}

.review__section h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}

.review__section p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-700);
}

.review__pre {
  white-space: pre-wrap;
}

.review__list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ink-700);
}

.review__foot {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-400);
}

.tip {
  margin-top: 14px;
}

/* ---- 上一题 / 下一题 ---- */
.pager {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pager__text {
  font-size: 13px;
  color: var(--ink-500);
}

/* ---- 题号导航 ---- */
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink-700);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.nav__item:hover {
  background: var(--bg);
}

.nav__item--active {
  background: var(--brand-50);
  color: var(--brand-600);
  font-weight: 500;
}

.nav__no {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg);
  font-size: 12px;
  color: var(--ink-500);
}

.nav__item--done .nav__no {
  background: var(--brand-50);
  color: var(--brand-600);
}

.nav__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav__score {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-600);
}

.nav__foot {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-400);
}

.hint p {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 8px;
}

.hint ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.9;
  color: var(--ink-500);
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
