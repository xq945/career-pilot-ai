<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Aim, Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { createMatch, listMatches } from '@/api/match'
import AiWaiting from '@/components/AiWaiting.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import ResourcePicker from '@/components/ResourcePicker.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 岗位匹配（《前端原型设计》§5.7，接口《API接口设计》6.1–6.2）。
 *
 * 列表 + 新建匹配弹窗。弹窗内的两个资源选择器各自带**就地拦截**（未分析 / 分析已过期），
 * 拦截生效时提交按钮禁用——落实验收标准「前端在弹窗内即拦截，不发出请求」。
 *
 * 提交为同步调用（通常 5–20 秒）：等待态在弹窗内呈现；502 失败时明确
 * 「本次未产生记录、可重试」；成功后跳转报告页。
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
    const data = await listMatches({ page: page.value, size: PAGE_SIZE })
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

/** 分数语义色标签（§5.7）：≥80 绿、60–79 蓝、<60 橙 */
function scoreType(score) {
  if (score >= 80) {
    return 'success'
  }
  if (score >= 60) {
    return 'primary'
  }
  return 'warning'
}

function openReport(item) {
  router.push({ name: 'match-report', params: { id: item.id } })
}

onMounted(load)

/* ---------------------------------------------------------------- 新建匹配 */

const dialogVisible = ref(false)
const resumeId = ref(null)
const jobId = ref(null)
const resumePicker = ref()
const jobPicker = ref()
const submitting = ref(false)
/** 提交失败信息 { code, message }；null 表示无 */
const submitError = ref(null)

/** 任一方被就地拦截（未分析 / 岗位分析过期）时禁止提交 */
const blockReason = computed(
  () => resumePicker.value?.blockReason ?? jobPicker.value?.blockReason ?? null,
)

const canSubmit = computed(
  () => resumeId.value !== null && jobId.value !== null && !blockReason.value && !submitting.value,
)

function openCreate() {
  resumeId.value = null
  jobId.value = null
  submitError.value = null
  dialogVisible.value = true
}

async function submit() {
  if (!canSubmit.value) {
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    const data = await createMatch({ resumeId: resumeId.value, jobId: jobId.value })
    dialogVisible.value = false
    // 每次匹配都是一条新记录：直接进入本次报告页
    router.push({ name: 'match-report', params: { id: data.id } })
  }
  catch (error) {
    submitError.value = { code: error.code, message: error.message || '匹配失败，请稍后重试' }
  }
  finally {
    submitting.value = false
  }
}

/** 失败文案：502 系列强调「未产生记录、可重试」，其余给后端文案 */
const submitErrorText = computed(() => {
  if (!submitError.value) {
    return ''
  }
  if (submitError.value.code === 50200 || submitError.value.code === 50201) {
    return `${submitError.value.message}（本次未产生匹配记录，可以重试）`
  }
  return submitError.value.message
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>岗位匹配</h1>
        <p class="page-head__desc">
          把简历与目标岗位放在一起评分，看清「匹配在哪、差距在哪」
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">
        新建匹配分析
      </el-button>
    </div>

    <el-card shadow="never" class="card">
      <template #header>
        <div class="card__head">
          <h2>匹配记录</h2>
          <span class="card__sub">同一组合可多次匹配，用于对比简历修改效果</span>
        </div>
      </template>

      <StateBlock
        :loading="loading"
        :error="loadError"
        :empty="records.length === 0"
        @retry="load"
      >
        <template #empty>
          <h3 class="state__title">还没有匹配记录</h3>
          <p class="state__text">
            选择一份已分析的简历与一个已分析的岗位，系统会按五个维度评分，并给出差距与改进建议。
          </p>
          <el-button type="primary" @click="openCreate">
            新建匹配分析
          </el-button>
        </template>

        <div class="item-list">
          <div v-for="item in records" :key="item.id" class="item">
            <div class="item__icon">
              <el-icon :size="18"><Aim /></el-icon>
            </div>
            <div class="item__main">
              <div class="item__title">
                <span class="item__name">{{ item.jobName }}</span>
                <el-tag :type="scoreType(item.matchScore)" size="small" effect="light">
                  {{ displayScore(item.matchScore) }}
                </el-tag>
              </div>
              <div class="item__meta">
                <template v-if="item.companyName">{{ item.companyName }} · </template>
                使用「{{ item.resumeName }}」v{{ item.resumeVersionNo }}
                · 「{{ item.jobName }}」v{{ item.jobVersionNo }}
                · {{ formatTime(item.createdAt) }}
              </div>
            </div>
            <div class="item__actions">
              <el-button size="small" @click="openReport(item)">
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

    <!-- 新建匹配弹窗：选择双方 → 就地拦截 → 提交 → 等待态 -->
    <el-dialog
      v-model="dialogVisible"
      title="新建匹配分析"
      width="680px"
      :close-on-click-modal="!submitting"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
    >
      <AiWaiting
        v-if="submitting"
        title="AI 正在生成匹配报告…"
        hint="评分由后端按固定权重计算，模型负责解释匹配项与差距，通常需要 5–20 秒。"
        leave-hint="匹配在服务器端进行；中途关闭页面不会影响结果，稍后可在列表中查看。"
      />

      <template v-else>
        <p class="dialog__desc">
          双方都需要先完成 AI 分析，系统才能提取可比的技能项。
        </p>

        <el-form label-position="top" @submit.prevent>
          <el-form-item label="选择简历" required>
            <ResourcePicker ref="resumePicker" v-model="resumeId" type="resume" />
          </el-form-item>
          <el-form-item label="选择岗位" required>
            <ResourcePicker ref="jobPicker" v-model="jobId" type="job" />
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

        <el-alert class="tip" type="info" :closable="false" show-icon>
          <p class="dialog__note">
            每次匹配都会<strong>新增一条记录</strong>，不会覆盖历史。修改简历后重新匹配，可以对比两次结果的变化。
          </p>
        </el-alert>
      </template>

      <template #footer>
        <el-button :disabled="submitting" @click="dialogVisible = false">
          取消
        </el-button>
        <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">
          开始匹配
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

.dialog__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}

.tip {
  margin-top: 12px;
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
