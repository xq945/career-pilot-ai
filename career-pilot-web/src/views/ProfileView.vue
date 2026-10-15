<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Edit } from '@element-plus/icons-vue'

import { listLlmProviders } from '@/api/llmProvider'
import { useUserStore } from '@/stores/user'

/**
 * 个人中心（《前端原型设计》§5.13，V1.5：展示 / 编辑两态）。
 *
 * 接口：PUT /api/user/profile（昵称）、POST/DELETE /api/user/avatar（头像）。
 * 基本资料默认**只读展示**，点修改图标进入编辑态；头像上传/移除**即时生效**、
 * 不随「保存修改」提交——「取消」只还原昵称、不撤销头像。
 */
const router = useRouter()
const userStore = useUserStore()

/* ---------- 基本资料：展示 / 编辑两态 ---------- */
const editing = ref(false)
const formRef = ref()
const saving = ref(false)
const form = reactive({ nickname: '' })

const rules = {
  // 不设 required：空串是合法的「清空昵称」表达（《API接口设计》3.4）
  nickname: [{ max: 50, message: '昵称不能超过 50 个字符', trigger: 'blur' }],
}

const currentNickname = computed(() => userStore.user?.nickname || '')

/** 点修改图标：展示态进入编辑态；编辑态再点视为取消 */
function startEdit() {
  if (editing.value) {
    cancelEdit()
    return
  }
  form.nickname = currentNickname.value
  editing.value = true
}

function cancelEdit() {
  form.nickname = currentNickname.value
  formRef.value?.clearValidate()
  editing.value = false
}

async function handleSave() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }
  saving.value = true
  try {
    await userStore.updateProfile(form.nickname.trim())
    ElMessage.success('已保存')
    editing.value = false
  }
  catch (error) {
    // 40001 的字段级提示优先展示（《前端原型设计》§7.1）
    if (error.code === 40001 && error.data?.nickname) {
      ElMessage.error(error.data.nickname)
    }
    else {
      ElMessage.error(error.message)
    }
  }
  finally {
    saving.value = false
  }
}

/* ---------- 头像（编辑态显示操作，上传/移除仍即时生效） ---------- */
const uploading = ref(false)
const brokenAvatar = ref('')

const avatarUrl = computed(() => {
  const url = userStore.user?.avatar
  return url && url !== brokenAvatar.value ? url : null
})

const hasAvatar = computed(() => Boolean(userStore.user?.avatar))

/** 客户端预检（与后端同规则）：仅为体验拦截，权威校验在服务端 */
function beforeAvatarUpload(file) {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    ElMessage.error('仅支持 JPG / PNG 格式的图片')
    return false
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.error('头像文件不能超过 2 MB')
    return false
  }
  return true
}

/** el-upload 自定义上传：走 axios 封装（携带 Token、统一响应处理） */
async function handleUpload({ file }) {
  uploading.value = true
  try {
    await userStore.changeAvatar(file)
    brokenAvatar.value = ''
    ElMessage.success('头像已更新')
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    uploading.value = false
  }
}

async function handleRemoveAvatar() {
  uploading.value = true
  try {
    await userStore.removeAvatar()
    brokenAvatar.value = ''
    ElMessage.success('头像已移除')
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    uploading.value = false
  }
}

/* ---------- 登录状态：本次登录时刻 + 已用时长 ---------- */
/** 从 Token 载荷解析签发时间（ms）；无 Token 或解析失败返回 null */
function readIssuedAt() {
  try {
    const part = userStore.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4)
    const issuedAt = JSON.parse(atob(padded)).iat
    return issuedAt ? issuedAt * 1000 : null
  }
  catch {
    return null
  }
}

const loginAt = computed(() => readIssuedAt())

const now = ref(Date.now())
let clockTimer

onMounted(() => {
  // 每分钟刷新「已使用时长」（Token 有效期以小时计，无需更细粒度）
  clockTimer = setInterval(() => { now.value = Date.now() }, 60000)
  loadProviderSummary()
})
onUnmounted(() => clearInterval(clockTimer))

/* ---------- 模型服务入口摘要（M14，§5.14）：加载失败不阻塞页面 ---------- */
const providerSummary = ref({
  name: '平台默认 · deepseek-flash',
  hint: '全部 AI 功能使用平台内置模型',
})

async function loadProviderSummary() {
  try {
    const providers = await listLlmProviders()
    const current = providers.find((item) => item.isDefault)
    if (!current) {
      return
    }
    providerSummary.value = {
      name: `${current.displayName} · ${current.model}`,
      hint: current.maskedApiKey
        ? '当前默认模型服务，全部 AI 功能使用该服务'
        : '当前默认服务尚未配置 API Key，调用将回退平台默认',
    }
  }
  catch {
    // 摘要加载失败保留默认文案（不打扰用户，管理页有完整错误态）
  }
}

const loginAtText = computed(() => {
  if (!loginAt.value) {
    return '—'
  }
  const d = new Date(loginAt.value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

const usedTimeText = computed(() => {
  if (!loginAt.value) {
    return '—'
  }
  const minutes = Math.max(1, Math.floor((now.value - loginAt.value) / 60000))
  return `${minutes} 分钟`
})

/* ---------- 退出登录（与顶栏菜单同一动作，原型 §3/§5.13） ---------- */
async function handleLogout() {
  await userStore.logout()
  ElMessage.success('已退出登录')
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="profile">
    <div class="page-head">
      <h1>个人中心</h1>
    </div>

    <!-- 基本资料：展示态 / 编辑态 -->
    <el-card shadow="never" class="card">
      <template #header>
        <div class="card__head">
          <h2>基本资料</h2>
          <button class="icon-btn" type="button" title="修改资料" aria-label="修改资料" @click="startEdit">
            <el-icon><Edit /></el-icon>
          </button>
        </div>
      </template>

      <div class="avatar-row">
        <img
          v-if="avatarUrl"
          class="avatar avatar--img"
          :src="avatarUrl"
          alt=""
          @error="brokenAvatar = userStore.user.avatar"
        >
        <span v-else class="avatar">{{ userStore.initial }}</span>
        <!-- 头像操作仅在编辑态出现；上传/移除仍即时生效 -->
        <div v-if="editing">
          <div class="avatar-row__actions">
            <el-upload
              action="#"
              :show-file-list="false"
              accept=".jpg,.jpeg,.png"
              :before-upload="beforeAvatarUpload"
              :http-request="handleUpload"
            >
              <el-button size="small" :loading="uploading">
                更换头像
              </el-button>
            </el-upload>
            <el-button size="small" :disabled="!hasAvatar || uploading" @click="handleRemoveAvatar">
              移除
            </el-button>
          </div>
          <div class="avatar-row__hint">支持 JPG / PNG，建议 200×200 像素以内；不超过 2 MB</div>
        </div>
      </div>

      <!-- 编辑态：可输入表单 -->
      <el-form v-if="editing" ref="formRef" :model="form" :rules="rules" label-position="top">
        <div class="field-grid">
          <el-form-item label="昵称" prop="nickname">
            <el-input v-model="form.nickname" maxlength="50" placeholder="请输入昵称" />
          </el-form-item>

          <el-form-item label="用户名">
            <el-input :model-value="userStore.user?.username ?? ''" disabled />
          </el-form-item>

          <el-form-item label="邮箱">
            <el-input :model-value="userStore.user?.email ?? ''" disabled />
          </el-form-item>

          <el-form-item label="用户 ID">
            <el-input :model-value="String(userStore.user?.id ?? '')" disabled />
          </el-form-item>
        </div>
      </el-form>

      <!-- 展示态：只读文本 -->
      <div v-else class="field-grid">
        <div class="field">
          <div class="field__label">昵称</div>
          <div class="field__static">{{ currentNickname || '—' }}</div>
        </div>
        <div class="field">
          <div class="field__label">用户名</div>
          <div class="field__static">{{ userStore.user?.username }}</div>
        </div>
        <div class="field">
          <div class="field__label">邮箱</div>
          <div class="field__static">{{ userStore.user?.email }}</div>
        </div>
        <div class="field">
          <div class="field__label">用户 ID</div>
          <div class="field__static">{{ userStore.user?.id }}</div>
        </div>
      </div>

      <div v-if="editing" class="card__foot">
        <el-button @click="cancelEdit">
          取消
        </el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">
          保存修改
        </el-button>
      </div>
    </el-card>

    <!-- 模型服务（M14，§5.14）：当前默认摘要 + 管理入口 -->
    <el-card shadow="never" class="card">
      <template #header>
        <h2>模型服务</h2>
      </template>
      <div class="session-row">
        <div>
          <div class="session-row__strong">{{ providerSummary.name }}</div>
          <div class="session-row__hint">{{ providerSummary.hint }}</div>
        </div>
        <el-button @click="router.push({ name: 'profile-providers' })">
          管理
        </el-button>
      </div>
    </el-card>

    <!-- 登录状态 -->
    <el-card shadow="never" class="card">
      <template #header>
        <h2>登录状态</h2>
      </template>
      <div class="session-row">
        <div>
          <div class="session-row__strong">当前设备已登录</div>
          <div class="session-row__hint">Token 有效期 2 小时，过期后需重新登录</div>
          <div class="session-row__hint">本次登录：{{ loginAtText }}　·　已使用：{{ usedTimeText }}</div>
        </div>
        <el-button type="danger" plain @click="handleLogout">
          退出登录
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
/* 内容区收窄至 820px 并水平居中（原型 §5.13 V1.5） */
.profile {
  max-width: 820px;
  margin: 0 auto;
}

.page-head {
  margin-bottom: 16px;
}

.page-head h1 {
  font-size: 22px;
  margin-bottom: 4px;
}

.card {
  border-radius: var(--radius);
  margin-bottom: 16px;
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

/* 卡片头右上角的修改图标按钮 */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--ink-500);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.icon-btn:hover {
  color: var(--brand-600);
  border-color: var(--brand-200);
  background: var(--brand-50);
}

/* ---- 头像行 ---- */
.avatar-row {
  display: flex;
  gap: 18px;
  margin-bottom: 20px;
}

.avatar {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  border-radius: 50%;
  background: var(--brand-600);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.avatar--img {
  object-fit: cover;
}

.avatar-row__actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.avatar-row__hint {
  font-size: 12px;
  color: var(--ink-400);
}

/* ---- 字段：展示态（文本）/ 编辑态（表单）共用两列网格 ---- */
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
}

.field {
  margin-bottom: 16px;
}

.field__label {
  font-size: 13px;
  color: var(--ink-700);
  margin-bottom: 6px;
  font-weight: 500;
}

/* 与输入框同高，保证两态切换时不跳动 */
.field__static {
  display: flex;
  align-items: center;
  height: 36px;
  font-size: 13px;
  color: var(--ink-900);
}

.card__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

/* ---- 登录状态 ---- */
.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.session-row__strong {
  font-weight: 600;
  color: var(--ink-900);
}

.session-row__hint {
  font-size: 12px;
  color: var(--ink-400);
  margin-top: 6px;
}

/* 窄屏：字段两列改单列 */
@media (max-width: 700px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
