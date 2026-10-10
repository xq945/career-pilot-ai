<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'

import { listJobs } from '@/api/job'
import { listResumes } from '@/api/resume'
import AnalysisStateTag from '@/components/AnalysisStateTag.vue'

/**
 * 资源选择器（《前端原型设计》§5.7）：在新建匹配弹窗内选择一份简历或一个岗位，每行带分析状态标签。
 *
 * 选中后的**两个就地拦截**（语义对应 `POST /api/matches` 的 400，但由前端先行拦截、不发出请求）：
 * 1. 未分析 → 提示先完成分析，「立即分析」跳转带 `?auto=1`（进入即发起）；
 * 2. 岗位分析已过期（stale）→ 提示先重新分析，跳转**不带** auto，让用户在过期警告条下自行确认。
 *
 * 父组件通过模板 ref 读取 `blockReason`（null 表示可提交）并据此禁用提交按钮。
 */
const props = defineProps({
  /** 资源类型：'resume' 简历 / 'job' 岗位 */
  type: { type: String, required: true },
  /** 选中的资源 id（v-model） */
  modelValue: { type: Number, default: null },
  /**
   * 使用场景：
   * - 'strict'（默认，匹配场景）：未分析/已过期即**就地拦截**，父组件禁用提交；
   * - 'context'（Agent 对话场景）：只提示不拦截——`matchResumeToJob` 等工具会按需自动补齐分析，
   *   上下文资源也不要求事先分析。
   */
  mode: { type: String, default: 'strict' },
})

const emit = defineEmits(['update:modelValue', 'select'])

const router = useRouter()

const isResume = computed(() => props.type === 'resume')

const loading = ref(false)
const loadError = ref('')
const records = ref([])

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    // 一次取足（上限 100 与后端 PageQuery 的 max 一致）；个人资源数量级小，不做翻页
    const data = isResume.value
      ? await listResumes({ page: 1, size: 100 })
      : await listJobs({ page: 1, size: 100 })
    records.value = data.records
  }
  catch (error) {
    loadError.value = error.message || '加载失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

const selected = computed(() => records.value.find((item) => item.id === props.modelValue) ?? null)

/** 提示原因：null = 无提示；'not-analyzed' / 'stale' */
const notice = computed(() => {
  const item = selected.value
  if (!item) {
    return null
  }
  if (!item.analyzed) {
    return 'not-analyzed'
  }
  // 岗位独有的过期态：分析仍存在，但基于旧版描述，不应再用于生成新的匹配报告
  if (!isResume.value && item.stale) {
    return 'stale'
  }
  return null
})

/**
 * 拦截原因：null = 当前选择可提交；'not-analyzed' / 'stale' 由父组件读取后禁用提交。
 * 'context' 模式下恒为 null（只提示不拦截，见 mode 的说明）。
 */
const blockReason = computed(() => (props.mode === 'context' ? null : notice.value))

defineExpose({ blockReason })

/** 选中项变化：除了刷新 v-model，还把完整记录抛给父组件（Agent 场景要显示资源名） */
function selectItem(item) {
  emit('update:modelValue', item.id)
  emit('select', item)
}

/** 拦截提示的跳转入口 */
function goFix() {
  const item = selected.value
  if (!item) {
    return
  }
  if (blockReason.value === 'not-analyzed') {
    router.push({
      name: isResume.value ? 'resume-analysis' : 'job-analysis',
      params: { id: item.id },
      query: { auto: '1' },
    })
    return
  }
  router.push({ name: 'job-analysis', params: { id: item.id } })
}

const formatTime = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—')

const itemName = (item) => (isResume.value ? item.name : item.jobName)
</script>

<template>
  <div class="picker">
    <div class="picker__list">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
      />
      <div v-else-if="loading" v-loading="true" class="picker__loading" />
      <el-empty
        v-else-if="records.length === 0"
        :image-size="60"
        :description="isResume ? '还没有简历，请先到「简历管理」上传' : '还没有岗位，请先到「岗位管理」新建'"
      />
      <template v-else>
        <label
          v-for="item in records"
          :key="item.id"
          class="picker__item"
          :class="{ 'picker__item--active': item.id === modelValue }"
        >
          <input
            type="radio"
            class="picker__radio"
            :name="`pick-${type}`"
            :checked="item.id === modelValue"
            @change="selectItem(item)"
          >
          <div class="picker__main">
            <div class="picker__title">
              {{ itemName(item) }}
            </div>
            <div class="picker__meta">
              <template v-if="!isResume && item.companyName">{{ item.companyName }} · </template>
              <template v-if="isResume">{{ item.fileType }} · </template>
              更新于 {{ formatTime(item.updatedAt) }}
            </div>
          </div>
          <AnalysisStateTag :analyzed="item.analyzed" :stale="item.stale" />
        </label>
      </template>
    </div>

    <!-- 提示与拦截：strict（匹配）下拦截并禁用提交；context（Agent 对话）下仅提示 -->
    <el-alert
      v-if="notice"
      class="picker__block"
      :type="mode === 'context' ? 'info' : 'warning'"
      :closable="false"
      show-icon
    >
      <template #title>
        <template v-if="notice === 'not-analyzed'">
          「{{ itemName(selected) }}」还没有完成分析
        </template>
        <template v-else>
          「{{ itemName(selected) }}」的分析已过期
        </template>
      </template>
      <p class="picker__block-text">
        <template v-if="mode === 'context'">
          仍然可以使用：助手会在需要时自动为你完成分析，无需提前操作。
        </template>
        <template v-else-if="notice === 'not-analyzed'">
          匹配需要双方的技能项作为依据，请先完成该{{ isResume ? '简历' : '岗位' }}的分析。
        </template>
        <template v-else>
          岗位描述在分析后已更新，请先重新分析，再基于新版要求发起匹配。
        </template>
      </p>
      <el-button
        v-if="mode !== 'context'"
        class="picker__block-btn"
        size="small"
        type="warning"
        plain
        @click="goFix"
      >
        {{ notice === 'not-analyzed' ? '立即分析' : '去重新分析' }}
      </el-button>
    </el-alert>
  </div>
</template>

<style scoped>
.picker__list {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  max-height: 208px;
  overflow-y: auto;
}

.picker__loading {
  height: 72px;
}

.picker__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.picker__item + .picker__item {
  border-top: 1px solid var(--line);
}

.picker__item:hover {
  background: var(--bg);
}

.picker__item--active {
  background: var(--brand-50);
}

.picker__radio {
  flex: 0 0 auto;
  accent-color: var(--brand-600);
}

.picker__main {
  flex: 1;
  min-width: 0;
}

.picker__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker__meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink-400);
}

.picker__block {
  margin-top: 10px;
}

.picker__block-text {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

.picker__block-btn {
  margin-top: 8px;
}
</style>
