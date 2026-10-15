<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { createSchedule, parseScheduleInvitation, updateSchedule } from '@/api/schedule'

/**
 * 面试日程 · 新建 / 编辑弹窗（M17，《前端原型设计》§5.15）。
 *
 * 顶部「粘贴邀请文本 → 解析」（仅新建时展示）：规则解析（绿标「请核对」）与 AI 解析
 * （蓝标「请重点核对」）的回填来自 §9A.1 的预览接口（不落库）；解析失败提示手工填写。
 * 提交走创建（携带 parseSource / confidence）或全量更新。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** null = 新建；对象 = 编辑该日程 */
  editing: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const formRef = ref()
const submitting = ref(false)
const parsing = ref(false)
const rawText = ref('')
/** 解析来源徽标：{ source } 或 null */
const parseInfo = ref(null)

const form = reactive({
  companyName: '',
  position: '',
  interviewTime: null,
  interviewType: 'VIDEO',
  meetingLink: '',
  roundNumber: 1,
  interviewer: '',
  notes: '',
  parseSource: 'MANUAL',
  confidence: null,
})

const rules = {
  companyName: [{ required: true, message: '请输入公司名', trigger: 'blur' }],
  position: [{ required: true, message: '请输入岗位名', trigger: 'blur' }],
  interviewTime: [{ required: true, message: '请选择面试时间', trigger: 'change' }],
}

watch(() => props.modelValue, (open) => {
  if (!open) {
    return
  }
  resetForm()
  if (props.editing) {
    fillFromEditing(props.editing)
  }
})

function resetForm() {
  rawText.value = ''
  parseInfo.value = null
  Object.assign(form, {
    companyName: '',
    position: '',
    interviewTime: null,
    interviewType: 'VIDEO',
    meetingLink: '',
    roundNumber: 1,
    interviewer: '',
    notes: '',
    parseSource: 'MANUAL',
    confidence: null,
  })
  formRef.value?.clearValidate()
}

/** 编辑回填：不重置来源（编辑不改变初始录入方式） */
function fillFromEditing(record) {
  Object.assign(form, {
    companyName: record.companyName ?? '',
    position: record.position ?? '',
    interviewTime: record.interviewTime ?? null,
    interviewType: record.interviewType ?? 'VIDEO',
    meetingLink: record.meetingLink ?? '',
    roundNumber: record.roundNumber ?? 1,
    interviewer: record.interviewer ?? '',
    notes: record.notes ?? '',
    parseSource: record.parseSource ?? 'MANUAL',
    confidence: record.parseConfidence ?? null,
  })
}

/** 粘贴解析：仅在解析出值时覆盖表单字段；失败提示手工填写（不弹全局错误） */
async function handleParse() {
  if (!rawText.value.trim()) {
    ElMessage.warning('请先粘贴面试邀请文本')
    return
  }
  parsing.value = true
  try {
    const result = await parseScheduleInvitation(rawText.value.trim())
    if (!result.success) {
      parseInfo.value = null
      ElMessage.warning(result.message || '未能识别邀请信息，请手工填写')
      return
    }
    const data = result.data ?? {}
    if (data.companyName) {
      form.companyName = data.companyName
    }
    if (data.position) {
      form.position = data.position
    }
    if (data.interviewTime) {
      form.interviewTime = data.interviewTime
    }
    if (data.interviewType) {
      form.interviewType = data.interviewType
    }
    if (data.meetingLink) {
      form.meetingLink = data.meetingLink
    }
    if (data.roundNumber) {
      form.roundNumber = data.roundNumber
    }
    if (data.interviewer) {
      form.interviewer = data.interviewer
    }
    if (data.notes) {
      form.notes = data.notes
    }
    form.parseSource = result.parseSource
    form.confidence = result.confidence
    parseInfo.value = { source: result.parseSource }
    ElMessage.success('已回填解析结果，请核对后保存')
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    parsing.value = false
  }
}

/** 禁用过去日期（体验层预拦截；服务端同规则兜底） */
const disabledDate = (date) => date.getTime() < Date.now() - 24 * 60 * 60 * 1000

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    const payload = {
      companyName: form.companyName.trim(),
      position: form.position.trim(),
      interviewTime: form.interviewTime,
      interviewType: form.interviewType,
      meetingLink: form.meetingLink.trim() || null,
      roundNumber: form.roundNumber,
      interviewer: form.interviewer.trim() || null,
      notes: form.notes.trim() || null,
    }
    if (props.editing) {
      await updateSchedule(props.editing.id, payload)
      ElMessage.success('日程已保存')
    }
    else {
      await createSchedule({ ...payload, parseSource: form.parseSource, confidence: form.confidence })
      ElMessage.success('日程已创建')
    }
    visible.value = false
    emit('saved')
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="editing ? '编辑面试日程' : '新建面试日程'"
    width="640px"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <!-- 粘贴解析区（仅新建时展示） -->
    <div v-if="!editing" class="parse-block">
      <el-input
        v-model="rawText"
        type="textarea"
        :rows="3"
        maxlength="5000"
        show-word-limit
        placeholder="粘贴面试邀请文本（飞书 / 腾讯会议 / Zoom / 邮件），自动识别公司、岗位与时间"
      />
      <div class="parse-block__foot">
        <el-button size="small" :loading="parsing" @click="handleParse">
          解析邀请
        </el-button>
        <el-tag v-if="parseInfo?.source === 'RULE'" type="success" size="small" effect="light">
          规则解析（请核对）
        </el-tag>
        <el-tag v-else-if="parseInfo?.source === 'AI'" type="primary" size="small" effect="light">
          AI 解析（请重点核对）
        </el-tag>
      </div>
    </div>

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <div class="field-grid">
        <el-form-item label="公司名" prop="companyName">
          <el-input v-model="form.companyName" maxlength="100" placeholder="如：示例科技" />
        </el-form-item>
        <el-form-item label="岗位名" prop="position">
          <el-input v-model="form.position" maxlength="100" placeholder="如：Java 后端开发" />
        </el-form-item>
      </div>
      <div class="field-grid">
        <el-form-item label="面试时间" prop="interviewTime">
          <el-date-picker
            v-model="form.interviewTime"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            :disabled-date="disabledDate"
            placeholder="选择日期与时间"
          />
        </el-form-item>
        <el-form-item label="面试形式">
          <el-select v-model="form.interviewType">
            <el-option label="视频 / 线上" value="VIDEO" />
            <el-option label="现场" value="ONSITE" />
            <el-option label="电话" value="PHONE" />
          </el-select>
        </el-form-item>
      </div>
      <div class="field-grid">
        <el-form-item label="轮次">
          <el-input-number v-model="form.roundNumber" :min="1" :max="10" />
        </el-form-item>
        <el-form-item label="面试官（可选）">
          <el-input v-model="form.interviewer" maxlength="50" />
        </el-form-item>
      </div>
      <el-form-item label="会议链接 / 会议号（可选）">
        <el-input v-model="form.meetingLink" maxlength="500" />
      </el-form-item>
      <el-form-item label="备注（可选）">
        <el-input v-model="form.notes" type="textarea" :rows="2" maxlength="1000" show-word-limit />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">
        取消
      </el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ editing ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.parse-block {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.parse-block__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

@media (max-width: 700px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
