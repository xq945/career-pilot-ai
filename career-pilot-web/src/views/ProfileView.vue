<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { useUserStore } from '@/stores/user'

/**
 * 个人中心（《前端原型设计》§5.13，V1.4 定死头像规格）。
 *
 * 接口：PUT /api/user/profile（昵称）、POST/DELETE /api/user/avatar（头像）。
 * 头像上传/移除**即时生效**、不随「保存修改」提交；顶栏与页面的同步
 * 由 user store 的 applyProfile 收口完成（内存 + localStorage 双写）。
 */
const router = useRouter()
const userStore = useUserStore()

/* ---------- 昵称表单 ---------- */
const formRef = ref()
const saving = ref(false)
const form = reactive({ nickname: userStore.user?.nickname ?? '' })

const rules = {
  // 不设 required：空串是合法的「清空昵称」表达（《API接口设计》3.4）
  nickname: [{ max: 50, message: '昵称不能超过 50 个字符', trigger: 'blur' }],
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

function handleCancel() {
  form.nickname = userStore.user?.nickname ?? ''
  // 放弃编辑时一并清除校验错误提示（如超长昵称留下的错误态）
  formRef.value?.clearValidate()
}

/* ---------- 头像 ---------- */
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
      <p class="page-head__desc">管理账号资料与登录状态</p>
    </div>

    <!-- 基本资料 -->
    <el-card shadow="never" class="card">
      <template #header>
        <div class="card__head">
          <h2>基本资料</h2>
          <span class="card__sub">昵称与头像会显示在页面右上角</span>
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
        <div>
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

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <div class="field-grid">
          <el-form-item label="昵称" prop="nickname">
            <el-input v-model="form.nickname" maxlength="50" placeholder="请输入昵称" />
            <div class="field__hint">可修改，不超过 50 个字符</div>
          </el-form-item>

          <el-form-item label="用户名">
            <el-input :model-value="userStore.user?.username ?? ''" disabled />
            <div class="field__hint">登录标识，创建后不可修改</div>
          </el-form-item>

          <el-form-item label="邮箱">
            <el-input :model-value="userStore.user?.email ?? ''" disabled />
            <div class="field__hint">登录标识，创建后不可修改</div>
          </el-form-item>

          <el-form-item label="用户 ID">
            <el-input :model-value="String(userStore.user?.id ?? '')" disabled />
            <div class="field__hint">系统内部标识</div>
          </el-form-item>
        </div>
      </el-form>

      <div class="card__foot">
        <el-button @click="handleCancel">
          取消
        </el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">
          保存修改
        </el-button>
      </div>
    </el-card>

    <!-- 数据与隐私 -->
    <el-card shadow="never" class="card">
      <template #header>
        <h2>数据与隐私</h2>
      </template>
      <ul class="bullets">
        <li>简历文本仅保存在服务端，用于 AI 分析，<strong>不会回传到浏览器</strong>，平台不提供简历原文的预览与下载。</li>
        <li>删除简历后，简历文件会从服务器同步删除；由该简历产生的分析、匹配与面试记录会<strong>保留</strong>，便于追溯历史结论。</li>
        <li>智能体对话记录与简历同属个人数据，仅本人可见。</li>
        <li>登录凭据保存在浏览器本地，退出登录即清除；如使用公共电脑，离开前请退出登录。</li>
      </ul>
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
        </div>
        <el-button type="danger" plain @click="handleLogout">
          退出登录
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
/* 内容区收窄至 820px（原型 §5.13 的页面宽度） */
.profile {
  max-width: 820px;
}

.page-head {
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
  align-items: baseline;
  justify-content: space-between;
}

.card__head h2 {
  font-size: 17px;
}

.card__sub {
  font-size: 12px;
  color: var(--ink-400);
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

/* ---- 字段 ---- */
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
}

.field__hint {
  font-size: 12px;
  color: var(--ink-400);
  line-height: 1.5;
  margin-top: 4px;
}

.card__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

/* ---- 数据与隐私 ---- */
.bullets {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--ink-700);
  line-height: 1.9;
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
