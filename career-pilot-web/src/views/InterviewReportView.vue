<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { categoryLabel, getInterviewReport, TYPE_LABELS } from '@/api/interview'
import ScoreRing from '@/components/ScoreRing.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 面试报告（《前端原型设计》§5.11，接口《API接口设计》§7.4）。
 *
 * 单请求：报告响应已含头部字段（岗位/题型/完成时间）与总评，
 * 无需再拉详情（V2.5 契约补充）。
 *
 * 只读契约：总分与总评都由提交回答时写入，本页只呈现、不重算；
 * 未完成时不显示总分环，改为「本场面试尚未完成」卡 + 继续答题入口，
 * 分类得分与逐题明细只统计已作答题目（未作答行给「去作答」入口）。
 *
 * 「查看回答」直接展开响应中已带的 answer/analysis（V2.1，R15），不发第二个请求。
 */
const route = useRoute()
const router = useRouter()
const sessionId = Number(route.params.id)

const loading = ref(true)
const loadError = ref('')
const report = ref(null)

/** 逐题「查看回答」展开状态：questionId → boolean */
const expanded = reactive({})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    report.value = await getInterviewReport(sessionId)
  }
  catch (error) {
    loadError.value = error.message || '加载失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

const questions = computed(() => report.value?.questions ?? [])
const categoryScores = computed(() => report.value?.categoryScores ?? [])
const strengths = computed(() => report.value?.strengths ?? [])
const weaknesses = computed(() => report.value?.weaknesses ?? [])
const recommendations = computed(() => report.value?.recommendations ?? [])

const formatTime = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—')

/** 分数展示去掉尾零（76.50 → 76.5）；分数本身由后端计算，前端不加工 */
const displayScore = (score) => Number(score)

const progressPercent = computed(() => {
  if (!report.value || report.value.questionCount === 0) {
    return 0
  }
  // 分母用实际题目数（questions 行数），与列表进度口径一致
  const total = questions.value.length || report.value.questionCount
  return Math.round((report.value.answeredCount / total) * 100)
})

function toggleAnswer(questionId) {
  expanded[questionId] = !expanded[questionId]
}

/** 「去作答」：跳到答题页并定位到该题（1 起） */
function goAnswer(index) {
  router.push({ name: 'interview-session', params: { id: sessionId }, query: { q: index + 1 } })
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <el-button link :icon="ArrowLeft" class="page-head__back" @click="router.push('/interviews')">
          返回面试列表
        </el-button>
        <h1>面试报告</h1>
        <p v-if="report" class="page-head__desc">
          {{ report.jobName ?? '岗位已删除' }}<template v-if="report.companyName"> · {{ report.companyName }}</template>
          · {{ TYPE_LABELS[report.questionType] ?? report.questionType }}
          · {{ report.completed ? `完成于 ${formatTime(report.completedAt)}` : `创建于 ${formatTime(report.completedAt ?? '')}` }}
        </p>
      </div>
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <div v-if="report" class="layout">
        <div class="layout__main">
          <!-- 已完成：总分环 + 总评 -->
          <el-card shadow="never" class="card">
            <div v-if="report.completed" class="score-row">
              <div class="score-row__ring">
                <ScoreRing :score="report.totalScore" caption="面试总分" />
              </div>
              <div class="score-row__summary">
                <div class="card__head">
                  <h2>总评</h2>
                  <el-tag type="success" size="small" effect="light">
                    已完成 · {{ report.answeredCount }} / {{ questions.length }} 题
                  </el-tag>
                </div>
                <p v-if="report.overallSummary" class="score-row__text">
                  {{ report.overallSummary }}
                </p>
                <p v-else class="score-row__text score-row__text--muted">
                  总评暂未生成（生成失败不影响成绩，重答任一题会重新生成）。
                </p>
                <div v-if="strengths.length" class="tag-line">
                  <span class="tag-line__label">强项</span>
                  <el-tag v-for="(item, index) in strengths" :key="`s${index}`" type="success" size="small" effect="plain">
                    {{ item }}
                  </el-tag>
                </div>
                <div v-if="weaknesses.length" class="tag-line">
                  <span class="tag-line__label">待提升</span>
                  <el-tag v-for="(item, index) in weaknesses" :key="`w${index}`" type="warning" size="small" effect="plain">
                    {{ item }}
                  </el-tag>
                </div>
              </div>
            </div>

            <!-- 未完成：进度卡 + 继续答题 -->
            <div v-else class="unfinished">
              <div class="card__head">
                <h2>本场面试尚未完成</h2>
                <el-tag type="warning" size="small" effect="light">进行中</el-tag>
              </div>
              <p class="unfinished__text">
                已答 {{ report.answeredCount }} / {{ questions.length }} 题 · 全部作答后自动生成总分与总评。
              </p>
              <el-progress :percentage="progressPercent" :show-text="false" />
              <div class="unfinished__actions">
                <el-button type="primary" @click="router.push({ name: 'interview-session', params: { id: sessionId } })">
                  继续答题
                </el-button>
              </div>
            </div>
          </el-card>

          <!-- 分类得分 -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>分类得分</h2>
                <span class="card__sub">
                  {{ report.completed ? '仅统计已作答题目' : `部分统计 · 已作答 ${report.answeredCount} 题` }}
                </span>
              </div>
            </template>

            <div v-if="categoryScores.length" class="bars">
              <div v-for="item in categoryScores" :key="item.category ?? 'unclassified'" class="bar-row">
                <span class="bar-row__label">{{ categoryLabel(item.category) }}</span>
                <div class="bar-row__track">
                  <div
                    class="bar-row__fill"
                    :style="{ width: `${Math.min(Math.max(Number(item.averageScore), 0), 100)}%` }"
                  />
                </div>
                <span class="bar-row__value">
                  {{ displayScore(item.averageScore) }} 分 · {{ item.questionCount }} 题
                </span>
              </div>
            </div>
            <p v-else class="bars__empty">还没有已作答的题目。</p>
          </el-card>

          <!-- 逐题明细 -->
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>逐题明细</h2>
                <span class="card__sub">{{ questions.length }} 题</span>
              </div>
            </template>

            <div class="detail-list">
              <div v-for="(item, index) in questions" :key="item.questionId" class="detail">
                <div class="detail__head" :class="{ 'detail__head--skipped': !item.answered }">
                  <span class="detail__no">{{ index + 1 }}</span>
                  <span class="detail__q">{{ item.question }}</span>
                  <el-tag size="small" effect="plain">{{ categoryLabel(item.questionCategory) }}</el-tag>
                  <span v-if="item.answered" class="detail__score">{{ displayScore(item.score) }} 分</span>
                  <span v-else class="detail__score detail__score--none">未作答</span>
                  <el-button v-if="item.answered" link type="primary" @click="toggleAnswer(item.questionId)">
                    {{ expanded[item.questionId] ? '收起回答' : '查看回答' }}
                  </el-button>
                  <el-button v-else link type="primary" @click="goAnswer(index)">
                    去作答
                  </el-button>
                </div>

                <div v-if="expanded[item.questionId]" class="detail__body">
                  <h4>我的回答</h4>
                  <p class="detail__pre">{{ item.answer }}</p>
                  <h4>AI 点评</h4>
                  <p>{{ item.analysis }}</p>
                </div>
              </div>
            </div>
          </el-card>

          <!-- 提升建议 -->
          <el-card v-if="report.completed && recommendations.length" shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>提升建议</h2>
                <span class="card__sub">来自本场面试的总评</span>
              </div>
            </template>
            <ul class="advice">
              <li v-for="(item, index) in recommendations" :key="index">{{ item }}</li>
            </ul>
          </el-card>
        </div>

        <!-- 右栏：会话信息与下一步 -->
        <aside class="layout__side">
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>会话信息</h2>
              </div>
            </template>
            <dl class="info">
              <dt>面试名称</dt>
              <dd>{{ report.title }}</dd>
              <dt>关联岗位</dt>
              <dd>{{ report.jobName ?? '已删除' }}<template v-if="report.companyName">（{{ report.companyName }}）</template></dd>
              <dt>题型</dt>
              <dd>{{ TYPE_LABELS[report.questionType] ?? report.questionType }}</dd>
              <dt>题目数</dt>
              <dd>计划 {{ report.questionCount }} 题 · 实际 {{ questions.length }} 题</dd>
            </dl>
          </el-card>

          <el-card shadow="never" class="card">
            <div class="next">
              <p class="next__title">下一步</p>
              <el-button class="next__btn" @click="router.push('/interviews')">
                再练一场
              </el-button>
              <el-button class="next__btn" @click="router.push('/matches')">
                回匹配报告
              </el-button>
            </div>
          </el-card>

          <p class="footnote">面试评分由 AI 生成，仅供参考，不代表真实面试结果。</p>
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

.card__sub {
  font-size: 13px;
  color: var(--ink-500);
}

/* ---- 总分 + 总评 ---- */
.score-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
}

.score-row__ring {
  flex: 0 0 auto;
}

.score-row__summary {
  flex: 1;
  min-width: 0;
}

.score-row__text {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-700);
}

.score-row__text--muted {
  color: var(--ink-400);
}

.tag-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.tag-line__label {
  font-size: 12px;
  color: var(--ink-400);
  margin-right: 2px;
}

/* ---- 未完成 ---- */
.unfinished__text {
  margin: 10px 0 8px;
  font-size: 13px;
  color: var(--ink-500);
}

.unfinished__actions {
  margin-top: 14px;
}

/* ---- 分类得分 ---- */
.bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bar-row {
  display: grid;
  grid-template-columns: 96px 1fr 110px;
  align-items: center;
  gap: 10px;
}

.bar-row__label {
  font-size: 13px;
  color: var(--ink-700);
}

.bar-row__track {
  height: 8px;
  border-radius: 999px;
  background: var(--bg);
  overflow: hidden;
}

.bar-row__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--brand-600);
}

.bar-row__value {
  font-size: 12px;
  color: var(--ink-500);
  text-align: right;
}

.bars__empty {
  font-size: 13px;
  color: var(--ink-400);
}

/* ---- 逐题明细 ---- */
.detail-list {
  display: flex;
  flex-direction: column;
}

.detail + .detail {
  border-top: 1px solid var(--line);
}

.detail__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 4px;
}

.detail__head--skipped {
  opacity: 0.6;
}

.detail__no {
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

.detail__q {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--ink-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail__score {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-600);
}

.detail__score--none {
  font-weight: 400;
  color: var(--ink-400);
}

.detail__body {
  padding: 0 4px 14px 36px;
}

.detail__body h4 {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 4px;
}

.detail__body p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-700);
  margin-bottom: 10px;
}

.detail__pre {
  white-space: pre-wrap;
}

/* ---- 提升建议 ---- */
.advice {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ink-700);
}

/* ---- 右栏 ---- */
.info {
  margin: 0;
  font-size: 13px;
}

.info dt {
  color: var(--ink-400);
  font-size: 12px;
  margin-top: 10px;
}

.info dt:first-child {
  margin-top: 0;
}

.info dd {
  color: var(--ink-700);
  margin: 2px 0 0;
  line-height: 1.7;
}

.next__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 10px;
}

.next__btn {
  width: 100%;
}

.next__btn + .next__btn {
  margin: 8px 0 0;
}

.footnote {
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-400);
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .score-row {
    flex-direction: column;
  }
}
</style>
