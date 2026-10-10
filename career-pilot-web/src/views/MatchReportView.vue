<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { getJob } from '@/api/job'
import { getMatch } from '@/api/match'
import { getResume } from '@/api/resume'
import DimensionBars from '@/components/DimensionBars.vue'
import ScoreRing from '@/components/ScoreRing.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 匹配报告 + 能力差距（《前端原型设计》§5.8，接口《API接口设计》6.3）。
 *
 * 页面渲染的全部是**已落库的历史数据**：分数由后端按固定权重计算（§5.6），
 * 模型只提供了三组明细、summary 与 suggestions。
 *
 * 措辞硬性要求（§5.8，全页生效）：只写「简历未体现」「缺少相关证据」，
 * 禁止「不具备」类断言；差距区块常驻免责说明；不得把分数解释为录用概率。
 *
 * 关联资源探测：报告不返回资源状态字段，前端用「详情接口 404」判断已删除
 * （《API接口设计》6.2 的约定），已删除时入口置灰、报告仍完整展示。
 */
const route = useRoute()
const router = useRouter()
const matchId = Number(route.params.id)

const loading = ref(true)
const loadError = ref('')
const report = ref(null)

/** 关联资源是否已被逻辑删除 */
const resumeMissing = ref(false)
const jobMissing = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    report.value = await getMatch(matchId)
    probeSources()
  }
  catch (error) {
    loadError.value = error.message || '加载失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

/** 探测源资源是否仍可访问（404 即已删除）；探测失败不影响报告本体 */
async function probeSources() {
  const [resumeResult, jobResult] = await Promise.allSettled([
    getResume(report.value.resumeId),
    getJob(report.value.jobId),
  ])
  resumeMissing.value = resumeResult.status === 'rejected' && resumeResult.reason?.code === 40400
  jobMissing.value = jobResult.status === 'rejected' && jobResult.reason?.code === 40400
}

onMounted(load)

/** dimension key → 中文标签：取自接口 items（前端不得硬编码维度名） */
const dimensionLabels = computed(() => {
  const map = {}
  for (const item of report.value?.dimensionScores?.items ?? []) {
    map[item.key] = item.label
  }
  return map
})

const dimensionLabel = (key) => dimensionLabels.value[key] ?? key

const displayScore = (score) => Number(score)
const formatTime = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—')

const matchedItems = computed(() => report.value?.matchedItems ?? [])
const partialItems = computed(() => report.value?.partialItems ?? [])
const missingItems = computed(() => report.value?.missingItems ?? [])
const suggestions = computed(() => report.value?.suggestions ?? [])

/** 评级标签（仅作视觉分级，不改变分数的含义） */
const scoreTag = computed(() => {
  const score = report.value?.matchScore ?? 0
  if (score >= 80) {
    return { type: 'success', text: '匹配良好' }
  }
  if (score >= 60) {
    return { type: 'primary', text: '匹配中等' }
  }
  return { type: 'warning', text: '匹配偏低' }
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <el-button link :icon="ArrowLeft" class="page-head__back" @click="router.push('/matches')">
          返回匹配列表
        </el-button>
        <h1>匹配报告</h1>
        <p v-if="report" class="page-head__desc">
          {{ report.jobName }}<template v-if="report.companyName"> · {{ report.companyName }}</template>
          · 使用「{{ report.resumeName }}」· {{ formatTime(report.createdAt) }}
        </p>
      </div>
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <div v-if="report" class="layout">
        <div class="layout__main">
          <!-- 总分与维度 -->
          <el-card shadow="never" class="card">
            <div class="score-row">
              <div class="score-row__ring">
                <ScoreRing :score="report.matchScore" />
                <el-tag class="score-row__tag" :type="scoreTag.type" size="small" effect="light">
                  {{ scoreTag.text }}
                </el-tag>
              </div>
              <div class="score-row__dims">
                <div class="card__head">
                  <h2>维度得分</h2>
                  <span class="card__sub">
                    总分由系统按固定权重计算 · 评分规则 {{ report.dimensionScores?.ruleVersion }}
                  </span>
                </div>
                <DimensionBars :items="report.dimensionScores?.items ?? []" />
              </div>
            </div>
            <div v-if="report.summary" class="card__foot">
              {{ report.summary }}
            </div>
          </el-card>

          <!-- 匹配明细三栏 -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>匹配明细</h2>
                <span class="card__sub">逐条对应岗位要求与简历证据</span>
              </div>
            </template>
            <div class="detail-grid">
              <div class="detail-col">
                <h3 class="detail-col__title detail-col__title--ok">
                  已匹配（{{ matchedItems.length }}）
                </h3>
                <div v-for="(item, index) in matchedItems" :key="`m${index}`" class="detail-item">
                  <span class="detail-item__text">{{ item.text }}</span>
                  <el-tag v-if="item.dimension" size="small" effect="plain">
                    {{ dimensionLabel(item.dimension) }}
                  </el-tag>
                </div>
                <p v-if="matchedItems.length === 0" class="detail-col__empty">暂无</p>
              </div>

              <div class="detail-col">
                <h3 class="detail-col__title detail-col__title--warn">
                  部分匹配（{{ partialItems.length }}）
                </h3>
                <div v-for="(item, index) in partialItems" :key="`p${index}`" class="detail-item">
                  <span class="detail-item__text">{{ item.text }}</span>
                  <el-tag v-if="item.dimension" size="small" effect="plain">
                    {{ dimensionLabel(item.dimension) }}
                  </el-tag>
                </div>
                <p v-if="partialItems.length === 0" class="detail-col__empty">暂无</p>
              </div>

              <div class="detail-col">
                <h3 class="detail-col__title detail-col__title--danger">
                  未体现（{{ missingItems.length }}）
                </h3>
                <div v-for="(item, index) in missingItems" :key="`x${index}`" class="detail-item">
                  <span class="detail-item__text">{{ item.text }}</span>
                  <el-tag v-if="item.dimension" size="small" effect="plain">
                    {{ dimensionLabel(item.dimension) }}
                  </el-tag>
                </div>
                <p v-if="missingItems.length === 0" class="detail-col__empty">暂无</p>
              </div>
            </div>
          </el-card>

          <!-- 能力差距分析（missingItems + 影响维度） -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>能力差距分析</h2>
                <span class="card__sub">按对总分的影响排序</span>
              </div>
            </template>

            <el-alert class="gap__note" type="info" :closable="false" show-icon>
              差额反映的是简历与岗位描述之间的<strong>信息缺口</strong>，不代表你不具备该能力。
              把相关经历补充进简历后，差距项会随之变化。
            </el-alert>

            <div v-for="(item, index) in missingItems" :key="`gap${index}`" class="gap-item">
              <div class="gap-item__text">
                {{ item.text }}
              </div>
              <div v-if="item.dimension" class="gap-item__dim">
                影响维度：{{ dimensionLabel(item.dimension) }}
              </div>
            </div>
            <p v-if="missingItems.length === 0" class="detail-col__empty">
              没有发现明显的差距项。
            </p>
          </el-card>

          <!-- 改进建议 -->
          <el-card shadow="never" class="card">
            <template #header>
              <h2>改进建议</h2>
            </template>
            <ol v-if="suggestions.length > 0" class="suggestions">
              <li v-for="(text, index) in suggestions" :key="`s${index}`">
                {{ text }}
              </li>
            </ol>
            <p v-else class="detail-col__empty">暂无建议。</p>
          </el-card>

          <p class="footnote">
            匹配分数反映简历与岗位描述之间的信息匹配程度，不代表录用概率或招聘结果预测。
          </p>
        </div>

        <!-- 右栏 -->
        <div class="layout__side">
          <el-card shadow="never" class="card">
            <template #header>
              <h2>本次匹配依据</h2>
            </template>
            <dl class="basis">
              <dt>使用简历</dt>
              <dd>{{ report.resumeName }} · v{{ report.resumeVersionNo }}</dd>
              <dt>目标岗位</dt>
              <dd>
                {{ report.jobName }}<template v-if="report.companyName"> · {{ report.companyName }}</template>
                · v{{ report.jobVersionNo }}
              </dd>
              <dt>匹配时间</dt>
              <dd>{{ formatTime(report.createdAt) }}</dd>
              <dt>评分规则</dt>
              <dd>{{ report.dimensionScores?.ruleVersion }}（权重 45 / 25 / 15 / 10 / 5）</dd>
            </dl>
          </el-card>

          <el-card shadow="never" class="card">
            <template #header>
              <h2>关联资源</h2>
            </template>
            <div class="source">
              <div class="source__row">
                <span class="source__label">简历</span>
                <el-button link :disabled="resumeMissing" @click="router.push('/resumes')">
                  {{ report.resumeName }}
                </el-button>
                <el-tag v-if="resumeMissing" type="info" size="small" effect="plain">
                  已删除
                </el-tag>
              </div>
              <div class="source__row">
                <span class="source__label">岗位</span>
                <el-button link :disabled="jobMissing" @click="router.push('/jobs')">
                  {{ report.jobName }}
                </el-button>
                <el-tag v-if="jobMissing" type="info" size="small" effect="plain">
                  已删除
                </el-tag>
              </div>
              <p v-if="resumeMissing || jobMissing" class="source__note">
                源资源已删除，本报告作为历史记录仍然保留。
              </p>
            </div>
          </el-card>
        </div>
      </div>
    </StateBlock>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 16px;
}

.page-head h1 {
  font-size: 22px;
  margin: 4px 0;
}

.page-head__desc {
  font-size: 13px;
  color: var(--ink-500);
}

.page-head__back {
  padding: 0;
}

/* ---- 两栏布局 ---- */
.layout {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 16px;
  align-items: start;
}

.layout__main,
.layout__side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }
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
  gap: 12px;
}

.card__head h2 {
  font-size: 17px;
}

.card__sub {
  font-size: 12px;
  color: var(--ink-500);
}

.card__foot {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-700);
}

/* ---- 总分与维度 ---- */
.score-row {
  display: flex;
  align-items: flex-start;
  gap: 32px;
}

.score-row__ring {
  flex: 0 0 auto;
  text-align: center;
}

.score-row__tag {
  margin-top: 10px;
}

.score-row__dims {
  flex: 1;
  min-width: 0;
}

.score-row__dims .card__head {
  margin-bottom: 14px;
}

/* ---- 匹配明细三栏 ---- */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 900px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}

.detail-col__title {
  font-size: 14px;
  margin-bottom: 10px;
}

.detail-col__title--ok {
  color: var(--ok);
}

.detail-col__title--warn {
  color: var(--warn);
}

.detail-col__title--danger {
  color: var(--danger);
}

.detail-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.detail-item__text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-700);
}

.detail-col__empty {
  font-size: 13px;
  color: var(--ink-400);
}

/* ---- 能力差距 ---- */
.gap__note {
  margin-bottom: 14px;
}

.gap-item {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--danger);
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
}

.gap-item__text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-700);
}

.gap-item__dim {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-400);
}

/* ---- 建议 ---- */
.suggestions {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 2;
  color: var(--ink-700);
}

.footnote {
  font-size: 12px;
  color: var(--ink-400);
  text-align: center;
}

/* ---- 右栏 ---- */
.basis {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
}

.basis dt {
  color: var(--ink-400);
  font-size: 12px;
  margin-top: 10px;
}

.basis dt:first-child {
  margin-top: 0;
}

.basis dd {
  margin: 2px 0 0;
  color: var(--ink-700);
}

.source__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
}

.source__label {
  flex: 0 0 38px;
  color: var(--ink-400);
  font-size: 12px;
}

.source__note {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-400);
}
</style>
