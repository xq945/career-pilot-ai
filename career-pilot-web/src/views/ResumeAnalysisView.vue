<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, MagicStick, Refresh, WarningFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { analyzeResume, getResume, getResumeAnalysis } from '@/api/resume'
import AiWaiting from '@/components/AiWaiting.vue'
import AnalysisStateTag from '@/components/AnalysisStateTag.vue'
import SkillTag from '@/components/SkillTag.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 简历 AI 分析（《前端原型设计》§5.4，接口《API接口设计》4.5–4.6）。
 *
 * 两类状态相互正交：
 * - `loading / loadError`：进入页面时的加载（GET 简历元数据 + GET 分析结果，并行）；
 * - `analyzing / analyzeError`：本次页内发起（POST analyze，超时 120 秒）。
 *
 * 三种页面形态由 `analyzed` 与 `analyzeError` 驱动（不做演示切换器）：
 * 未分析（发起入口）/ 等待中（AiWaiting）/ 已分析（结果）；
 * 发起失败时展示 502 系列文案与重试，**不丢失页面上下文**。
 *
 * M20 起入口在工作台与优化链路（列表页入口已删除）：均以 `?auto=1` 跳转到本页并自动发起
 * （等待态、失败态与重试只在本页实现一处）；不带 auto 即「查看」语义。
 */
const route = useRoute()
const router = useRouter()
const resumeId = Number(route.params.id)

/* ---------------------------------------------------------------- 页面加载 */

const loading = ref(true)
const loadError = ref('')
const resume = ref(null)
/** 最新一版成功分析；null 表示未分析 */
const analysis = ref(null)

const analyzed = computed(() => Boolean(analysis.value))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [resumeData, analysisData] = await Promise.all([
      getResume(resumeId),
      getResumeAnalysis(resumeId),
    ])
    resume.value = resumeData
    analysis.value = analysisData.analyzed ? analysisData.analysis : null
  }
  catch (error) {
    loadError.value = error.message || '加载失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

/* ---------------------------------------------------------------- 发起分析 */

const analyzing = ref(false)
/** 本次发起的失败信息 { code, message }；null 表示无失败 */
const analyzeError = ref(null)

/** 发起前确认：说明耗时（原型 §5.4 的两个确认弹窗合并为一处） */
async function confirmAnalyze() {
  try {
    await ElMessageBox.confirm(
      analyzed.value
        ? '重新分析会再次请求大模型并生成新版本（通常需要 10–30 秒）。'
        : '分析会调用一次大模型，通常需要 10–30 秒。',
      analyzed.value ? '重新分析这份简历？' : '发起 AI 分析？',
      {
        confirmButtonText: analyzed.value ? '确定' : '开始分析',
        cancelButtonText: '取消',
      },
    )
    return true
  }
  catch {
    return false
  }
}

async function startAnalyze() {
  if (analyzing.value) {
    return
  }
  const confirmed = await confirmAnalyze()
  if (!confirmed) {
    return
  }
  analyzing.value = true
  analyzeError.value = null
  try {
    // 成功响应即最新分析结果（结构同 GET analysis 的 analysis），直接渲染、无需再查
    const result = await analyzeResume(resumeId)
    analysis.value = result
    // 每次重新分析都生成新版本（2026-10-13 起不再复用），版本号如实展示
    ElMessage.success(`分析完成（v${result.versionNo}）`)
  }
  catch (error) {
    analyzeError.value = { code: error.code, message: error.message }
  }
  finally {
    analyzing.value = false
  }
}

/** 502 系列文案（《前端原型设计》§5.4）；不写「不计费」——输出解析失败时模型已产生调用 */
const failText = computed(() => {
  const code = analyzeError.value?.code
  if (code === 50200) {
    return '大模型服务暂时不可用（50200）。本次分析没有产生任何记录，可以直接重试。'
  }
  if (code === 50201) {
    return '大模型输出无法解析（50201）。系统已丢弃本次结果，不会保存不完整的数据，可以重试。'
  }
  return analyzeError.value?.message || '分析失败，请稍后重试。'
})

/* ---------------------------------------------------------------- 展示工具 */

const formatTime = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—')

onMounted(async () => {
  await load()
  // 工作台 / 优化链路入口（M20：列表页入口已删除）：加载完成后自动发起
  if (!loading.value && !loadError.value && route.query.auto === '1') {
    startAnalyze()
  }
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <el-button link :icon="ArrowLeft" class="page-head__back" @click="router.push('/resumes')">
          返回简历列表
        </el-button>
        <h1>{{ resume?.name || '简历 AI 分析' }}</h1>
        <p v-if="resume" class="page-head__desc">
          {{ resume.fileType }} · 上传于 {{ formatTime(resume.createdAt) }}
        </p>
      </div>
      <AnalysisStateTag :analyzed="analyzed" :analyzing="analyzing" />
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <!-- 等待态 -->
      <AiWaiting v-if="analyzing" />

      <!-- 本次发起失败（保留页面上下文，仅展示错误与重试） -->
      <el-card v-else-if="analyzeError" shadow="never" class="card">
        <div class="fail">
          <el-icon :size="30" class="fail__icon"><WarningFilled /></el-icon>
          <h3 class="fail__title">分析未能完成</h3>
          <p class="fail__text">{{ failText }}</p>
          <div class="fail__actions">
            <el-button type="primary" @click="startAnalyze">重试分析</el-button>
            <el-button @click="router.push('/resumes')">返回列表</el-button>
          </div>
          <p class="fail__note">如果多次重试仍失败，可能是模型服务限流或网络异常，请稍后再试。</p>
        </div>
      </el-card>

      <!-- 未分析 -->
      <el-card v-else-if="!analyzed" shadow="never" class="card">
        <div class="empty">
          <el-icon :size="30" class="empty__icon"><MagicStick /></el-icon>
          <h3 class="empty__title">这份简历还没有做过 AI 分析</h3>
          <p class="empty__text">
            分析结果同时是简历定向优化的前置条件。分析会调用一次大模型，通常需要 10–30 秒。
          </p>
          <el-button type="primary" @click="startAnalyze">发起 AI 分析</el-button>
        </div>
      </el-card>

      <!-- 已分析：结果 -->
      <div v-else class="layout">
        <div class="layout__main">
          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>简历概述</h2>
                <el-tag type="success" size="small" effect="light">分析成功</el-tag>
              </div>
            </template>
            <p class="summary">{{ analysis.summary || '（模型未给出概述）' }}</p>
          </el-card>

          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>技能清单</h2>
                <span class="card__sub">共 {{ analysis.skills?.length || 0 }} 项</span>
              </div>
            </template>
            <div v-if="analysis.skills?.length" class="skill-grid">
              <SkillTag
                v-for="(skill, index) in analysis.skills"
                :key="index"
                :name="skill.name || '（未命名技能）'"
                :level="skill.level || ''"
                :evidence="skill.evidence || ''"
              />
            </div>
            <p v-else class="muted">
              模型未从简历中识别出技能项。
            </p>
          </el-card>

          <div class="grid-2">
            <el-card shadow="never" class="card">
              <template #header>
                <h2>优势</h2>
              </template>
              <ul v-if="analysis.advantages?.length" class="bullets bullets--ok">
                <li v-for="(item, index) in analysis.advantages" :key="index">{{ item }}</li>
              </ul>
              <p v-else class="muted">未识别到明显优势。</p>
            </el-card>

            <el-card shadow="never" class="card">
              <template #header>
                <h2>待改进</h2>
              </template>
              <ul v-if="analysis.weaknesses?.length" class="bullets bullets--warn">
                <li v-for="(item, index) in analysis.weaknesses" :key="index">{{ item }}</li>
              </ul>
              <p v-else class="muted">未识别到明显短板。</p>
            </el-card>
          </div>

          <el-card shadow="never" class="card">
            <template #header>
              <div class="card__head">
                <h2>改进建议</h2>
                <span class="card__sub">按优先级排序</span>
              </div>
            </template>
            <ol v-if="analysis.suggestions?.length" class="suggestions">
              <li v-for="(item, index) in analysis.suggestions" :key="index">{{ item }}</li>
            </ol>
            <p v-else class="muted">未给出改进建议。</p>
          </el-card>
        </div>

        <div class="layout__side">
          <el-card shadow="never" class="card">
            <template #header>
              <h2>分析信息</h2>
            </template>
            <dl class="desc">
              <div class="desc__row">
                <dt>简历</dt>
                <dd>{{ resume?.name }}</dd>
              </div>
              <div class="desc__row">
                <dt>文件类型</dt>
                <dd>{{ resume?.fileType }}</dd>
              </div>
              <div class="desc__row">
                <dt>分析版本</dt>
                <dd>v{{ analysis.versionNo }}</dd>
              </div>
              <div class="desc__row">
                <dt>分析时间</dt>
                <dd>{{ formatTime(analysis.createdAt) }}</dd>
              </div>
              <div class="desc__row">
                <dt>使用模型</dt>
                <dd>{{ analysis.modelName }}</dd>
              </div>
            </dl>
            <p class="side-note">
              每次重新分析都会调用大模型生成新版本，旧版本仍保留可追溯。
            </p>
            <el-button class="side-action" :icon="Refresh" @click="startAnalyze">
              重新分析
            </el-button>
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
  gap: 16px;
  margin-bottom: 16px;
}

.page-head__back {
  margin-bottom: 6px;
  font-size: 13px;
}

.page-head h1 {
  font-size: 22px;
  margin-bottom: 4px;
}

.page-head__desc {
  font-size: 13px;
  color: var(--ink-500);
}

/* ---- 卡片通用 ---- */
.card {
  border-radius: var(--radius);
}

.card + .card,
.layout__main > * + * {
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
  gap: 12px;
}

.card__head h2,
.card h2 {
  font-size: 17px;
}

.card__sub {
  font-size: 13px;
  color: var(--ink-500);
}

/* ---- 结果布局 ---- */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

@media (max-width: 1080px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.summary {
  font-size: 14px;
  line-height: 1.9;
  color: var(--ink-700);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.muted {
  font-size: 13px;
  color: var(--ink-400);
}

/* 优势 / 待改进 列表 */
.bullets {
  padding-left: 18px;
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--ink-700);
}

.bullets li + li {
  margin-top: 2px;
}

.bullets--ok {
  list-style: disc;
}

.bullets--warn {
  list-style: circle;
}

.suggestions {
  padding-left: 20px;
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--ink-700);
  list-style: decimal;
}

/* ---- 右侧栏 ---- */
.desc {
  font-size: 13px;
}

.desc__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.desc__row + .desc__row {
  border-top: 1px dashed var(--line);
}

.desc__row dt {
  color: var(--ink-500);
  flex: 0 0 auto;
}

.desc__row dd {
  color: var(--ink-900);
  text-align: right;
  word-break: break-all;
}

.side-note {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-400);
}

.side-action {
  margin-top: 12px;
  width: 100%;
}

/* ---- 未分析 / 失败 ---- */
.empty,
.fail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 20px;
  text-align: center;
}

.empty__icon {
  color: var(--brand-600);
}

.empty__title,
.fail__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.empty__text,
.fail__text {
  max-width: 460px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-500);
}

.fail__icon {
  color: var(--danger, #c45656);
}

.fail__actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.fail__note {
  font-size: 12px;
  color: var(--ink-400);
}
</style>
