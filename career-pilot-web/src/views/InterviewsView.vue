<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChatLineSquare, Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { QUESTION_TYPES, TYPE_LABELS, createInterview, listInterviews } from '@/api/interview'
import { listJobs } from '@/api/job'
import AiWaiting from '@/components/AiWaiting.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * AI 面试列表（《前端原型设计》§5.9，接口《API接口设计》§7.1/§7.3）。
 *
 * 进度口径：分母用 `generatedCount`（**实际**题数）而非 `questionCount`（计划）——
 * 出题去重后实际可能少于计划，用计划数会出现「已答 5/5 却未完成」的误导（§7.3）。
 *
 * 创建弹窗：岗位为必填（不要求已分析——面试出题只用岗位描述，与匹配的
 * 「双方已分析」前置不同），面试名称默认「{岗位名}模拟面试」，提交后进入出题等待态；
 * 失败文案明确「不会产生空会话」。
 *
 * 顶部提醒只基于**当前页** records 判断（列表接口无过滤参数，全局提醒需另加接口，
 * 见《验证记录》遗留）。
 */
const PAGE_SIZE = 10

const router = useRouter()

/* ---------------------------------------------------------------- 列表 */

const loading = ref(false)
const loadError = ref('')
const records = ref([])
const total = ref(0)
const page = ref(1)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await listInterviews({ page: page.value, size: PAGE_SIZE })
    records.value = data.records
    total.value = data.total
  }
  catch (error) {
    loadError.value = error.message
  }
  finally {
    loading.value = false
  }
}

function changePage(next) {
  page.value = next
  load()
}

const formatTime = (iso) => dayjs(iso).format('YYYY-MM-DD HH:mm')

/** 分数展示去掉尾零（76.50 → 76.5）；分数本身由后端计算，前端不加工 */
const displayScore = (score) => Number(score)

/** 状态标签：进行中带「已答 x / 实际 y」进度（§7.3） */
function statusTag(item) {
  if (item.status === 1) {
    return { type: 'success', text: '已完成' }
  }
  if (item.status === 2) {
    return { type: 'info', text: '已取消' }
  }
  return { type: 'primary', text: `进行中 · ${item.answeredCount}/${item.generatedCount}` }
}

/** 当页第一条进行中的会话（顶部提醒与「继续答题」入口） */
const ongoing = computed(() => records.value.find((item) => item.status === 0) ?? null)

function openSession(item) {
  router.push({ name: 'interview-session', params: { id: item.id } })
}

function openReport(item) {
  router.push({ name: 'interview-report', params: { id: item.id } })
}

onMounted(load)

/* ---------------------------------------------------------------- 创建面试 */

const dialogVisible = ref(false)
const jobs = ref([])
const jobsLoading = ref(false)
const jobsError = ref('')
const formRef = ref()
const submitting = ref(false)
/** 提交失败信息 { code, message }；null 表示无 */
const submitError = ref(null)

const form = reactive({
  jobId: null,
  title: '',
  questionType: 'MIXED',
  questionCount: 5,
})

/** 用户是否手改过名称：手改后不再随岗位联动覆盖 */
const titleTouched = ref(false)

const formRules = {
  jobId: [{ required: true, message: '请选择岗位', trigger: 'change' }],
  title: [
    { required: true, message: '请输入面试名称', trigger: 'blur' },
    { max: 100, message: '面试名称不能超过 100 个字符', trigger: 'blur' },
  ],
}

async function loadJobs() {
  jobsLoading.value = true
  jobsError.value = ''
  try {
    const data = await listJobs({ page: 1, size: 100 })
    jobs.value = data.records
  }
  catch (error) {
    jobsError.value = error.message || '岗位列表加载失败'
  }
  finally {
    jobsLoading.value = false
  }
}

function openCreate() {
  form.jobId = null
  form.title = ''
  form.questionType = 'MIXED'
  form.questionCount = 5
  titleTouched.value = false
  submitError.value = null
  dialogVisible.value = true
  loadJobs()
}

/** 选择岗位后，未手改过的名称联动为「{岗位名}模拟面试」（原型 §5.9 默认值） */
function onJobChange(jobId) {
  if (titleTouched.value) {
    return
  }
  const job = jobs.value.find((item) => item.id === jobId)
  form.title = job ? `${job.jobName}模拟面试` : ''
}

async function submit() {
  try {
    await formRef.value.validate()
  }
  catch {
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    const data = await createInterview({
      jobId: form.jobId,
      title: form.title.trim(),
      questionType: form.questionType,
      questionCount: form.questionCount,
    })
    dialogVisible.value = false
    // 题目已生成：直接进入答题页
    router.push({ name: 'interview-session', params: { id: data.id } })
  }
  catch (error) {
    submitError.value = { code: error.code, message: error.message || '题目生成失败，请稍后重试' }
  }
  finally {
    submitting.value = false
  }
}

/** 失败文案：502 系列强调「不产生空会话、可重试」 */
const submitErrorText = computed(() => {
  if (!submitError.value) {
    return ''
  }
  if (submitError.value.code === 50200 || submitError.value.code === 50201) {
    return `${submitError.value.message}（本次不会产生空会话，可以直接重试）`
  }
  return submitError.value.message
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>AI 面试</h1>
        <p class="page-head__desc">
          围绕目标岗位生成面试题，逐题作答获得 AI 评价，全部完成后生成面试报告
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">
        新建模拟面试
      </el-button>
    </div>

    <el-alert
      v-if="ongoing"
      class="tip"
      type="info"
      :closable="false"
      show-icon
    >
      <template #title>
        有 1 场面试还没做完（已答 {{ ongoing.answeredCount }} / {{ ongoing.generatedCount }} 题）·
        <el-button link type="primary" @click="openSession(ongoing)">继续答题</el-button>
      </template>
    </el-alert>

    <el-card shadow="never" class="card">
      <template #header>
        <div class="card__head">
          <h2>面试记录</h2>
          <span class="card__sub">全部题目作答后自动生成总分与总评</span>
        </div>
      </template>

      <StateBlock
        :loading="loading"
        :error="loadError"
        :empty="records.length === 0"
        @retry="load"
      >
        <template #empty>
          <h3 class="state__title">还没有面试记录</h3>
          <p class="state__text">
            选择一个已录入的岗位，AI 会围绕岗位要求生成面试题，逐题作答后给出评价与面试报告。
          </p>
          <el-button type="primary" @click="openCreate">
            开始模拟面试
          </el-button>
        </template>

        <div class="item-list">
          <div v-for="item in records" :key="item.id" class="item">
            <div class="item__icon">
              <el-icon :size="18"><ChatLineSquare /></el-icon>
            </div>
            <div class="item__main">
              <div class="item__title">
                <span class="item__name">{{ item.title }}</span>
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
              <div class="item__meta">
                {{ item.jobName }}<template v-if="item.companyName">（{{ item.companyName }}）</template>
                · {{ TYPE_LABELS[item.questionType] ?? item.questionType }}
                · {{ item.generatedCount }} 题
                · {{ formatTime(item.createdAt) }}
              </div>
            </div>
            <div class="item__actions">
              <el-button v-if="item.status === 0" size="small" type="primary" @click="openSession(item)">
                继续答题
              </el-button>
              <el-button v-else size="small" @click="openReport(item)">
                查看报告
              </el-button>
            </div>
          </div>
        </div>
      </StateBlock>

      <div v-if="!loading && !loadError && records.length > 0" class="card__foot">
        <PaginationBar
          :total="total"
          :page="page"
          :size="PAGE_SIZE"
          @update:page="changePage"
        />
      </div>
    </el-card>

    <!-- 新建模拟面试：选择岗位与题型 → 出题等待态 → 跳转答题页 -->
    <el-dialog
      v-model="dialogVisible"
      title="新建模拟面试"
      width="620px"
      :close-on-click-modal="!submitting"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
    >
      <AiWaiting
        v-if="submitting"
        title="AI 正在生成面试题…"
        hint="出题通常需要 10–40 秒；生成结果会自动去重，实际题数可能略少于设定值。"
        leave-hint="题目与会话在生成成功后才会入库；中途关闭页面不会产生空会话，稍后可在列表中查看。"
      />

      <template v-else>
        <p class="dialog__desc">
          面试题会围绕所选岗位的职责与要求生成；岗位无需事先完成 AI 分析。
        </p>

        <el-form ref="formRef" :model="form" :rules="formRules" label-position="top" @submit.prevent>
          <el-form-item label="选择岗位" prop="jobId">
            <el-select
              v-model="form.jobId"
              placeholder="请选择岗位"
              style="width: 100%"
              :loading="jobsLoading"
              @change="onJobChange"
            >
              <el-option
                v-for="job in jobs"
                :key="job.id"
                :label="job.companyName ? `${job.jobName}（${job.companyName}）` : job.jobName"
                :value="job.id"
              />
            </el-select>
            <p v-if="jobsError" class="dialog__hint dialog__hint--error">{{ jobsError }}</p>
            <p v-else-if="!jobsLoading && jobs.length === 0" class="dialog__hint">
              还没有岗位，请先到<a @click="router.push('/jobs')">岗位管理</a>录入目标岗位。
            </p>
          </el-form-item>

          <el-form-item label="面试名称" prop="title">
            <el-input
              v-model="form.title"
              maxlength="100"
              placeholder="默认使用「岗位名 + 模拟面试」"
              @input="titleTouched = true"
            />
          </el-form-item>

          <el-form-item label="题型" prop="questionType">
            <el-radio-group v-model="form.questionType">
              <el-radio-button
                v-for="type in QUESTION_TYPES"
                :key="type.value"
                :value="type.value"
              >
                {{ type.label }}
              </el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="题目数量" prop="questionCount">
            <el-input-number v-model="form.questionCount" :min="1" :max="20" />
            <span class="dialog__hint">生成结果会自动去重，实际题数可能略少，进度以实际题数为准。</span>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="submitError"
          class="tip"
          type="error"
          :closable="false"
          show-icon
        >
          {{ submitErrorText }}
        </el-alert>
      </template>

      <template #footer>
        <el-button :disabled="submitting" @click="dialogVisible = false">
          取消
        </el-button>
        <el-button type="primary" :disabled="submitting" :loading="submitting" @click="submit">
          生成题目
        </el-button>
      </template>
    </el-dialog>
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

.page-head h1 {
  font-size: 22px;
  margin-bottom: 4px;
}

.page-head__desc {
  font-size: 13px;
  color: var(--ink-500);
}

.card {
  border-radius: var(--radius);
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

.card__sub {
  font-size: 13px;
  color: var(--ink-500);
}

.card__foot {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

/* ---- 列表项 ---- */
.item-list {
  display: flex;
  flex-direction: column;
}

.item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 12px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.item + .item {
  border-top: 1px solid var(--line);
}

.item:hover {
  background: var(--bg);
}

.item__icon {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--brand-50);
  color: var(--brand-600);
}

.item__main {
  flex: 1;
  min-width: 0;
}

.item__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-900);
}

.item__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item__meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-400);
}

.item__actions {
  flex: 0 0 auto;
}

/* ---- 弹窗 ---- */
.dialog__desc {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--ink-500);
}

.dialog__hint {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-400);
}

.dialog__hint--error {
  color: var(--danger);
}

.dialog__hint a {
  color: var(--brand-600);
  cursor: pointer;
}

.tip {
  margin-bottom: 16px;
}

.state__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.state__text {
  max-width: 420px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-500);
  margin-bottom: 4px;
}
</style>
