<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import {
  createLlmProvider,
  deleteLlmProvider,
  listLlmProviders,
  setDefaultLlmProvider,
  testLlmProvider,
  updateLlmProvider,
} from '@/api/llmProvider'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 模型服务（《前端原型设计》§5.14，M14；《API接口设计》§3A）。
 *
 * 个人中心子路由，侧栏不新增导航项。页面规则：
 * - 内置服务不可删、当前默认不可删、未配置 Key 的服务不可设为默认（按钮禁用 + hover 提示原因）；
 * - 连通性测试失败返回 ok:false（**就地展示**，不弹全局错误——失败是预期结果）；
 * - API Key 加密存储，界面只显示掩码；编辑时留空 = 保留原 Key。
 */
const router = useRouter()

/* ---------- 列表 ---------- */
const loading = ref(true)
const loadError = ref('')
const providers = ref([])

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    providers.value = await listLlmProviders()
  }
  catch (error) {
    loadError.value = error.message
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

/* ---------- 连通性测试（结果就地展示） ---------- */
const testingId = ref(null)
const testResults = reactive({})

async function handleTest(provider) {
  testingId.value = provider.id
  delete testResults[provider.id]
  try {
    testResults[provider.id] = await testLlmProvider(provider.id)
  }
  catch (error) {
    testResults[provider.id] = { ok: false, message: error.message }
  }
  finally {
    testingId.value = null
  }
}

/* ---------- 设为默认 ---------- */
const settingDefaultId = ref(null)

/** 可设为默认：已启用、已配置 Key、且不是当前默认 */
function canSetDefault(provider) {
  return Boolean(provider.enabled && provider.maskedApiKey) && !provider.isDefault
}

/** 禁用原因（hover 提示；可设置时返回空串、tooltip 不显示） */
function setDefaultHint(provider) {
  if (provider.isDefault) {
    return '已是当前默认服务'
  }
  if (!provider.enabled) {
    return '该服务已停用，无法设为默认'
  }
  if (!provider.maskedApiKey) {
    return '请先配置 API Key'
  }
  return ''
}

async function handleSetDefault(provider) {
  settingDefaultId.value = provider.id
  try {
    await setDefaultLlmProvider(provider.id)
    ElMessage.success(`已将「${provider.displayName}」设为默认`)
    await load()
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    settingDefaultId.value = null
  }
}

/* ---------- 删除（内置服务不显示按钮；默认服务按钮禁用） ---------- */
async function handleDelete(provider) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${provider.displayName}」吗？删除不影响已有记录，但后续调用将不可再选择该服务。`,
      '删除模型服务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  }
  catch {
    return
  }
  try {
    await deleteLlmProvider(provider.id)
    ElMessage.success('服务已删除')
    await load()
  }
  catch (error) {
    ElMessage.error(error.message)
  }
}

/* ---------- 新增 / 编辑弹窗 ---------- */
const dialogVisible = ref(false)
/** null = 新增；非空 = 编辑对应服务 */
const editingId = ref(null)
const submitting = ref(false)
const formRef = ref()
const form = reactive({
  displayName: '',
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
})

/** 编辑内置服务时接口地址只读（§3A.3：内置 baseUrl 不可修改） */
const isBuiltinEditing = computed(() => {
  const current = providers.value.find((item) => item.id === editingId.value)
  return Boolean(current?.builtin)
})

/** API Key：新增必填；编辑留空 = 保留原 Key */
const formRules = computed(() => ({
  displayName: [
    { required: true, message: '请输入服务名称', trigger: 'blur' },
    { max: 100, message: '服务名称不能超过 100 个字符', trigger: 'blur' },
  ],
  baseUrl: [
    { required: true, message: '请输入接口地址', trigger: 'blur' },
    { pattern: /^https?:\/\//, message: '接口地址必须以 http:// 或 https:// 开头', trigger: 'blur' },
  ],
  model: [
    { required: true, message: '请输入模型名', trigger: 'blur' },
    { max: 100, message: '模型名不能超过 100 个字符', trigger: 'blur' },
  ],
  apiKey: editingId.value === null
    ? [{ required: true, message: '请输入 API Key', trigger: 'blur' }]
    : [],
}))

function openCreate() {
  editingId.value = null
  form.displayName = ''
  form.baseUrl = ''
  form.model = ''
  form.apiKey = ''
  form.temperature = 0.3
  dialogVisible.value = true
}

function openEdit(provider) {
  editingId.value = provider.id
  form.displayName = provider.displayName
  form.baseUrl = provider.baseUrl
  form.model = provider.model
  form.apiKey = ''
  form.temperature = Number(provider.temperature ?? 0.3)
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    if (editingId.value === null) {
      await createLlmProvider({
        displayName: form.displayName.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        apiKey: form.apiKey.trim(),
        temperature: form.temperature,
      })
      ElMessage.success('服务已创建')
    }
    else {
      const payload = {
        displayName: form.displayName.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        temperature: form.temperature,
      }
      if (form.apiKey.trim()) {
        payload.apiKey = form.apiKey.trim()
      }
      await updateLlmProvider(editingId.value, payload)
      ElMessage.success('服务已更新')
    }
    dialogVisible.value = false
    await load()
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
  <div class="providers">
    <div class="page-head">
      <el-button class="page-head__back" link @click="router.push({ name: 'profile' })">
        ← 返回个人中心
      </el-button>
      <div class="page-head__row">
        <h1>模型服务</h1>
        <el-button type="primary" @click="openCreate">
          新增服务
        </el-button>
      </div>
      <p class="page-head__hint">
        这里配置的默认服务将用于全部 AI 功能；未配置时使用平台内置模型。
      </p>
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <el-card shadow="never" class="card">
        <div v-for="provider in providers" :key="provider.id" class="provider-row">
          <div class="provider-row__main">
            <div class="provider-row__title">
              {{ provider.displayName }}
              <el-tag v-if="provider.builtin" size="small" effect="plain">
                内置
              </el-tag>
              <el-tag v-if="provider.isDefault" size="small" type="success" effect="light">
                默认
              </el-tag>
              <el-tag v-if="!provider.enabled" size="small" type="info" effect="plain">
                已停用
              </el-tag>
            </div>
            <div class="provider-row__meta">
              {{ provider.model }} · {{ provider.baseUrl }}
            </div>
            <div class="provider-row__meta">
              <template v-if="provider.maskedApiKey">API Key：{{ provider.maskedApiKey }}</template>
              <span v-else class="provider-row__warn">未配置 API Key</span>
            </div>
            <div
              v-if="testResults[provider.id]"
              class="provider-row__test"
              :class="testResults[provider.id].ok ? 'is-ok' : 'is-fail'"
            >
              <template v-if="testResults[provider.id].ok">
                连接正常 · {{ testResults[provider.id].model }} · {{ testResults[provider.id].latencyMs }} ms
              </template>
              <template v-else>{{ testResults[provider.id].message }}</template>
            </div>
          </div>
          <div class="provider-row__actions">
            <el-button size="small" :loading="testingId === provider.id" @click="handleTest(provider)">
              测试
            </el-button>
            <el-tooltip :disabled="!setDefaultHint(provider)" :content="setDefaultHint(provider)" placement="top">
              <span>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :disabled="!canSetDefault(provider)"
                  :loading="settingDefaultId === provider.id"
                  @click="handleSetDefault(provider)"
                >
                  设为默认
                </el-button>
              </span>
            </el-tooltip>
            <el-button size="small" @click="openEdit(provider)">
              编辑
            </el-button>
            <el-tooltip v-if="!provider.builtin" :disabled="!provider.isDefault" content="请先切换默认服务" placement="top">
              <span>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :disabled="provider.isDefault"
                  @click="handleDelete(provider)"
                >
                  删除
                </el-button>
              </span>
            </el-tooltip>
          </div>
        </div>
      </el-card>
      <p class="foot-note">
        API Key 加密存储，界面只显示掩码。
      </p>
    </StateBlock>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId === null ? '新增模型服务' : '编辑模型服务'"
      width="620px"
      :close-on-click-modal="!submitting"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-position="top">
        <el-form-item label="服务名称" prop="displayName">
          <el-input v-model="form.displayName" maxlength="100" placeholder="如：我的 Kimi" />
        </el-form-item>

        <el-form-item label="接口地址" prop="baseUrl">
          <el-input
            v-model="form.baseUrl"
            maxlength="500"
            :disabled="isBuiltinEditing"
            placeholder="https://api.example.com/v1"
          />
          <div class="form-hint">
            OpenAI 兼容接口地址，通常以 /v1 结尾{{ isBuiltinEditing ? '；内置服务的地址不可修改' : '' }}
          </div>
        </el-form-item>

        <el-form-item label="模型名" prop="model">
          <el-input v-model="form.model" maxlength="100" placeholder="如：kimi-latest" />
        </el-form-item>

        <el-form-item label="API Key" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            maxlength="500"
            :placeholder="editingId === null ? '必填，服务端加密存储' : '已配置，留空则不修改'"
          />
        </el-form-item>

        <el-form-item label="temperature（可选）">
          <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" :precision="2" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button :disabled="submitting" @click="dialogVisible = false">
          取消
        </el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 与个人中心同宽（820px 居中，原型 §5.13/§5.14） */
.providers {
  max-width: 820px;
  margin: 0 auto;
}

.page-head {
  margin-bottom: 16px;
}

.page-head__back {
  margin-bottom: 6px;
}

.page-head__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-head h1 {
  font-size: 22px;
}

.page-head__hint {
  font-size: 13px;
  color: var(--ink-400);
  margin-top: 4px;
}

.card {
  border-radius: var(--radius);
}

.card :deep(.el-card__body) {
  padding: 6px 18px;
}

.provider-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}

.provider-row:last-child {
  border-bottom: none;
}

.provider-row__main {
  min-width: 0;
}

.provider-row__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--ink-900);
}

.provider-row__meta {
  font-size: 12px;
  color: var(--ink-400);
  margin-top: 6px;
  word-break: break-all;
}

.provider-row__warn {
  color: var(--el-color-danger);
}

.provider-row__test {
  margin-top: 8px;
  font-size: 12px;
}

.provider-row__test.is-ok {
  color: var(--el-color-success);
}

.provider-row__test.is-fail {
  color: var(--el-color-danger);
}

.provider-row__actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.form-hint {
  font-size: 12px;
  color: var(--ink-400);
  line-height: 1.6;
}

.foot-note {
  font-size: 12px;
  color: var(--ink-400);
  margin-top: 12px;
  text-align: center;
}

@media (max-width: 760px) {
  .provider-row {
    flex-direction: column;
  }
}
</style>
