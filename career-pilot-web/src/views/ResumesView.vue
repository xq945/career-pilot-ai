<script setup>
import { h, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Plus, UploadFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { listResumes, removeResume, uploadResume } from '@/api/resume'
import AnalysisStateTag from '@/components/AnalysisStateTag.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 简历管理（《前端原型设计》§5.3，接口《API接口设计》4.1–4.4）。
 *
 * 页面内容：列表（加载 / 空 / 错误 / 正常四态）+ 上传对话框 + 删除二次确认。
 * 「发起分析」入口属 M4（本阶段状态标签恒为「未分析」）。
 *
 * 提示分工（§5.3）：上传的三类失败（41300/41500/400）显示在**弹窗内**并保持弹窗打开
 * （原型 §6.2），成功提示用页内 alert；删除结果用全局提示。
 * 时间字段用 dayjs 解析（API §1：精度不保证，禁止字符串截取）。
 */
const PAGE_SIZE = 10

/** 与后端三重校验同规则的客户端预检（仅为体验拦截，权威校验在服务端） */
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'html', 'htm', 'txt']
const MAX_FILE_BYTES = 10 * 1024 * 1024
const TYPE_HINT = '文件类型不支持，仅支持 PDF、DOCX、DOC、HTML、TXT 格式'

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
    const data = await listResumes({ page: page.value, size: PAGE_SIZE })
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

onMounted(load)

/* ---------------------------------------------------------------- 上传 */

const uploadVisible = ref(false)
const uploading = ref(false)
const uploadRef = ref()
const uploadForm = reactive({ file: null, name: '' })
/** 弹窗内的失败提示（前端预检或服务端 41300/41500/400） */
const uploadError = ref('')
/** 页面顶部的上传成功提示 */
const uploadNotice = ref('')

function openUpload() {
  uploadForm.file = null
  uploadForm.name = ''
  uploadError.value = ''
  uploadVisible.value = true
}

function closeUpload() {
  uploadVisible.value = false
}

/**
 * el-upload 的前置校验：`auto-upload=false` 时仅触发本回调、不发请求；
 * 真正提交由弹窗的「开始上传」按钮调用 axios 完成。
 */
function handleFileChange(uploadFile) {
  uploadError.value = ''
  const file = uploadFile?.raw
  if (!file) {
    return
  }
  const extension = file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : ''
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    failSelection(TYPE_HINT)
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    failSelection('文件过大，单个文件不能超过 10 MB')
    return
  }
  uploadForm.file = file
}

/** 预检失败：提示 + 丢弃已选文件（同时清空 el-upload 的内部列表） */
function failSelection(message) {
  uploadError.value = message
  uploadForm.file = null
  uploadRef.value?.clearFiles()
}

async function submitUpload() {
  if (!uploadForm.file) {
    uploadError.value = '请先选择要上传的简历文件'
    return
  }
  uploading.value = true
  uploadError.value = ''
  try {
    const data = await uploadResume(uploadForm.file, uploadForm.name.trim())
    uploadVisible.value = false
    // 列表按 created_at 倒序，新简历在第 1 页首位
    page.value = 1
    await load()
    uploadNotice.value = `「${data.name}」上传成功，文本已提取，可以发起 AI 分析了。`
  }
  catch (error) {
    // 失败保持弹窗打开、可重新选择文件（§6.2）；三类失败的文案按 §5.3
    uploadError.value = mapUploadError(error)
  }
  finally {
    uploading.value = false
  }
}

function mapUploadError(error) {
  if (error.code === 41300) {
    return '文件过大，单个文件不能超过 10 MB'
  }
  if (error.code === 41500) {
    return TYPE_HINT
  }
  // 40000（如"未能从文件中提取文字"）直接用服务端文案，避免两处维护
  return error.message || '上传失败，请稍后重试'
}

const formatSize = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/* ---------------------------------------------------------------- 删除 */

/** 删除确认：写清三条后果（§4.5），用 VNode 渲染（转义用户输入，不拼 HTML） */
function confirmDelete(item) {
  return ElMessageBox.confirm(
    h('div', [
      h('p', `即将删除「${item.name}」。`),
      h('ul', { class: 'confirm-list' }, [
        h('li', '简历文件会从服务器同步删除，此操作不可撤销。'),
        h('li', '由该简历产生的分析、匹配和面试记录会保留，便于追溯历史结论。'),
        h('li', '这些记录中原先指向该简历的入口将提示「关联简历已删除」。'),
      ]),
    ]),
    '删除这份简历？',
    {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    },
  )
}

async function handleDelete(item) {
  try {
    await confirmDelete(item)
  }
  catch {
    return // 用户取消
  }
  try {
    await removeResume(item.id)
    ElMessage.success(`「${item.name}」已删除`)
    // 当前页删空且不在第 1 页时回退一页，避免落在空页
    if (records.value.length === 1 && page.value > 1) {
      page.value -= 1
    }
    await load()
  }
  catch (error) {
    ElMessage.error(error.message)
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>简历管理</h1>
        <p class="page-head__desc">
          上传 PDF、DOCX、DOC、HTML 或 TXT 简历，系统提取文本后用于 AI 分析与岗位匹配
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openUpload">
        上传简历
      </el-button>
    </div>

    <!-- 上传成功提示（页内 alert，§5.3） -->
    <el-alert
      v-if="uploadNotice"
      class="notice"
      type="success"
      :closable="true"
      @close="uploadNotice = ''"
    >
      {{ uploadNotice }}
    </el-alert>

    <el-card shadow="never" class="card">
      <template #header>
        <div class="card__head">
          <h2>我的简历</h2>
          <span v-if="total > 0" class="card__sub">共 {{ total }} 份</span>
        </div>
      </template>

      <StateBlock
        :loading="loading"
        :error="loadError"
        :empty="records.length === 0"
        @retry="load"
      >
        <template #empty>
          <h3 class="state__title">还没有简历</h3>
          <p class="state__text">
            上传一份 PDF、DOCX、DOC、HTML 或 TXT 简历，系统会自动提取文本，用于 AI 分析与岗位匹配。
          </p>
          <el-button type="primary" @click="openUpload">
            上传简历
          </el-button>
        </template>

        <div class="item-list">
          <div v-for="item in records" :key="item.id" class="item">
            <div class="item__icon">
              <el-icon :size="18"><Document /></el-icon>
            </div>
            <div class="item__main">
              <div class="item__title">
                <span class="item__name">{{ item.name }}</span>
                <AnalysisStateTag :analyzed="item.analyzed" />
              </div>
              <div class="item__meta">
                {{ item.fileType }} · 上传于 {{ formatTime(item.createdAt) }}
              </div>
            </div>
            <div class="item__actions">
              <el-button size="small" type="danger" plain @click="handleDelete(item)">
                删除
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

    <!-- 上传对话框 -->
    <el-dialog
      v-model="uploadVisible"
      title="上传简历"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-upload
        ref="uploadRef"
        drag
        action="#"
        :auto-upload="false"
        :show-file-list="false"
        accept=".pdf,.docx,.doc,.html,.htm,.txt"
        :on-change="handleFileChange"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">
          <strong>点击选择文件</strong>，或拖拽文件到此处
        </div>
        <template #tip>
          <div class="el-upload__tip">
            支持 PDF、DOCX、DOC、HTML、TXT，单个文件不超过 10 MB
          </div>
        </template>
      </el-upload>

      <div v-if="uploadForm.file" class="upload-file">
        已选择：{{ uploadForm.file.name }}（{{ formatSize(uploadForm.file.size) }}）
      </div>

      <div class="field">
        <label class="field__label">简历名称</label>
        <el-input
          v-model="uploadForm.name"
          maxlength="100"
          placeholder="留空则使用原文件名"
        />
      </div>

      <el-alert
        class="tip"
        type="info"
        :closable="false"
        show-icon
      >
        请上传含可复制文本的文件。扫描件与图片无法提取文字，系统会拒绝入库。
      </el-alert>

      <el-alert
        v-if="uploadError"
        class="tip"
        type="error"
        :closable="false"
        show-icon
      >
        {{ uploadError }}
      </el-alert>

      <template #footer>
        <el-button @click="closeUpload">
          取消
        </el-button>
        <el-button type="primary" :loading="uploading" @click="submitUpload">
          开始上传
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

.notice {
  margin-bottom: 16px;
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

/* ---- 上传对话框 ---- */
.upload-file {
  margin-top: 12px;
  font-size: 13px;
  color: var(--ink-700);
}

.field {
  margin-top: 16px;
}

.field__label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-700);
  margin-bottom: 6px;
}

.tip {
  margin-top: 12px;
}

/* 空态文案（#empty 插槽内） */
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

/* 删除确认弹窗的列表：三条后果 */
:deep(.confirm-list) {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ink-700);
}
</style>
