<script setup>
import { computed, ref } from 'vue'
import { Promotion } from '@element-plus/icons-vue'

import ResourcePicker from '@/components/ResourcePicker.vue'

/**
 * 输入区（原型 §5.12）：上下文 chips（可选）+ 输入框 + 发送。
 *
 * 上下文资源通过 {@link ResourcePicker} 选择（`mode="context"`：未分析只提示不拦截——
 * 工具会在需要时自动补齐分析）；最多一份简历 + 一个岗位，随每次请求携带。
 *
 * 发送后清空输入框；父组件在本轮失败时调用 {@link restore} 把草稿放回（失败轮不落库，
 * 内容不应丢失）。
 */
const props = defineProps({
  /** { resumeId, resumeName, jobId, jobName } */
  context: { type: Object, required: true },
  sending: { type: Boolean, default: false },
})

const emit = defineEmits(['send', 'update:context'])

const MAX_LENGTH = 2000

const draft = ref('')
const pickerVisible = ref(false)
const pickerType = ref('resume')
const pickerValue = ref(null)
/** ResourcePicker 抛出的完整记录（含名称），点选后更新 */
const pickedName = ref(null)

const canSend = computed(() => !props.sending && draft.value.trim().length > 0)

const pickerTitle = computed(() => (pickerType.value === 'resume' ? '选择简历' : '选择岗位'))

function openPicker(type) {
  pickerType.value = type
  pickerValue.value = type === 'resume' ? props.context.resumeId : props.context.jobId
  pickedName.value = null
  pickerVisible.value = true
}

function confirmPicker() {
  if (pickerValue.value === null) {
    return
  }
  // 记录名与状态来自 ResourcePicker 的 select 事件；未收到时（回显既有选择）保留原名
  const name = pickedName.value ?? (pickerType.value === 'resume'
    ? props.context.resumeName : props.context.jobName)
  const next = { ...props.context }
  if (pickerType.value === 'resume') {
    next.resumeId = pickerValue.value
    next.resumeName = name ?? ''
  }
  else {
    next.jobId = pickerValue.value
    next.jobName = name ?? ''
  }
  emit('update:context', next)
  pickerVisible.value = false
}

function onSelect(item) {
  pickedName.value = pickerType.value === 'resume'
    ? (item.name ?? '')
    : [item.jobName, item.companyName].filter(Boolean).join(' @ ')
}

function clearContext(kind) {
  const next = { ...props.context }
  if (kind === 'resume') {
    next.resumeId = null
    next.resumeName = ''
  }
  else {
    next.jobId = null
    next.jobName = ''
  }
  emit('update:context', next)
}

function submit() {
  if (!canSend.value) {
    return
  }
  const text = draft.value.trim()
  emit('send', text)
  draft.value = ''
}

/** 本轮失败时由父组件调用：把内容放回输入框供重试 */
function restore(text) {
  if (!draft.value) {
    draft.value = text
  }
}

/** 空态的示例问题：填入输入框（不直接发送，留给用户修改的余地） */
function setDraft(text) {
  draft.value = text
}

defineExpose({ restore, setDraft })
</script>

<template>
  <div class="composer">
    <div class="composer__ctx">
      <span class="composer__ctx-label">引用上下文（可选）：</span>

      <el-tag
        v-if="context.resumeId"
        type="primary"
        effect="light"
        closable
        @close="clearContext('resume')"
      >
        简历：{{ context.resumeName || `#${context.resumeId}` }}
      </el-tag>
      <el-tag
        v-if="context.jobId"
        type="primary"
        effect="light"
        closable
        @close="clearContext('job')"
      >
        岗位：{{ context.jobName || `#${context.jobId}` }}
      </el-tag>

      <el-button v-if="!context.resumeId" size="small" @click="openPicker('resume')">
        + 选择简历
      </el-button>
      <el-button v-if="!context.jobId" size="small" @click="openPicker('job')">
        + 选择岗位
      </el-button>
    </div>

    <div class="composer__row">
      <el-input
        v-model="draft"
        type="textarea"
        :rows="2"
        :maxlength="MAX_LENGTH"
        show-word-limit
        resize="none"
        placeholder="问点什么，比如「我的简历还缺什么」"
        @keydown.enter.exact.prevent="submit"
      />
      <el-button
        class="composer__send"
        type="primary"
        :icon="Promotion"
        :loading="sending"
        :disabled="!canSend"
        @click="submit"
      >
        发送
      </el-button>
    </div>

    <p class="composer__hint">
      助手只基于你的简历、岗位与系统分析结果作答，不会编造数据。单次提问最多调用 5 个工具、
      最长等待 120 秒；对话中可能为你生成分析、匹配或面试记录。
    </p>

    <el-dialog v-model="pickerVisible" :title="pickerTitle" width="560px">
      <ResourcePicker
        :type="pickerType"
        v-model="pickerValue"
        mode="context"
        @select="onSelect"
      />
      <template #footer>
        <el-button @click="pickerVisible = false">
          取消
        </el-button>
        <el-button type="primary" :disabled="pickerValue === null" @click="confirmPicker">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.composer {
  border-top: 1px solid var(--line);
  background: var(--surface);
  padding: 12px 18px 14px;
}

.composer__ctx {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 32px;
  margin-bottom: 10px;
}

.composer__ctx-label {
  font-size: 12px;
  color: var(--ink-400);
}

.composer__row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.composer__row :deep(.el-textarea) {
  flex: 1;
}

.composer__send {
  height: 34px;
}

.composer__hint {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-400);
}
</style>
