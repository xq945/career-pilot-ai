<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import AuthLayout from '@/layouts/AuthLayout.vue'
import { useUserStore } from '@/stores/user'

/**
 * 注册页（《前端原型设计》§5.1）。
 *
 * 接口：POST /api/auth/register，请求体 { username, email, password }。
 * 校验规则与后端 RegisterRequest 的注解一一对应，前端即校验是为了尽早反馈，
 * 权威判定仍在后端 —— 前端校验通过不代表后端一定接受。
 */
const router = useRouter()
const userStore = useUserStore()

const formRef = ref()
const submitting = ref(false)
const errorMessage = ref('')

const form = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
})

/** 服务端返回的字段级错误（如"用户名已被占用"），与表单校验结果分开存放 */
const fieldErrors = reactive({
  username: '',
  email: '',
})

/** 与后端 RegisterRequest 的 @Pattern 保持一致 */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

function validateConfirmPassword(rule, value, callback) {
  if (!value) {
    callback(new Error('请再次输入密码'))
    return
  }
  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
    return
  }
  callback()
}

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    // 后端为 @Size(min = 3, max = 50)
    { min: 3, max: 50, message: '用户名长度需在 3 至 50 个字符之间', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
    { max: 100, message: '邮箱长度不能超过 100 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    {
      pattern: PASSWORD_PATTERN,
      message: '密码长度不少于 8 位，且同时包含字母与数字',
      trigger: 'blur',
    },
  ],
  confirmPassword: [{ validator: validateConfirmPassword, trigger: 'blur' }],
}

function clearFieldError(field) {
  fieldErrors[field] = ''
}

/**
 * 把服务端错误落到对应字段。
 *
 * 后端对用户名/邮箱重复返回的是 40000（业务异常）且 data 为空、不带字段名，
 * 因此只能按 message 文案判断归属；其余错误作为整表提示。
 * 若日后后端将这两处改为 40001 + fieldErrors，应改用 error.data 做精确映射。
 */
function applyServerError(error) {
  if (error.message?.includes('用户名')) {
    fieldErrors.username = error.message
    return
  }
  if (error.message?.includes('邮箱')) {
    fieldErrors.email = error.message
    return
  }
  errorMessage.value = error.message
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }

  submitting.value = true
  errorMessage.value = ''
  clearFieldError('username')
  clearFieldError('email')

  try {
    await userStore.register({
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
    })
  }
  catch (error) {
    applyServerError(error)
    submitting.value = false
    return
  }

  // 注册接口只返回 UserProfile、不含 Token，因此紧接着登录一次，
  // 完成原型上"注册并登录"的交互（见 prototype/login.html 的按钮文案）。
  try {
    await userStore.login({ account: form.username.trim(), password: form.password })
    ElMessage.success('注册成功')
    router.replace('/dashboard')
  }
  catch {
    // 极少数情况：注册成功但自动登录失败（如刚注册即被禁用）。
    // 这不是注册失败，不能给出误导性提示。
    ElMessage.success('注册成功，请使用刚才的账号登录')
    router.replace({ name: 'login', query: { account: form.username.trim() } })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <h2 class="auth__title">创建账号</h2>
    <p class="auth__desc">注册后即可上传简历并开始 AI 分析</p>

    <el-alert
      v-if="errorMessage"
      class="auth__alert"
      type="error"
      :closable="false"
      show-icon
      :title="errorMessage"
    />

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="用户名" prop="username" :error="fieldErrors.username">
        <el-input
          v-model="form.username"
          placeholder="3–50 个字符，全站唯一"
          autocomplete="username"
          @input="clearFieldError('username')"
        />
      </el-form-item>

      <el-form-item label="邮箱" prop="email" :error="fieldErrors.email">
        <el-input
          v-model="form.email"
          placeholder="name@example.com"
          autocomplete="email"
          @input="clearFieldError('email')"
        />
      </el-form-item>

      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          placeholder="不少于 8 位，含字母与数字"
          autocomplete="new-password"
          show-password
        />
      </el-form-item>

      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          placeholder="再次输入密码"
          autocomplete="new-password"
          show-password
          @keyup.enter="handleSubmit"
        />
      </el-form-item>

      <el-button
        class="auth__submit"
        type="primary"
        size="large"
        :loading="submitting"
        @click="handleSubmit"
      >
        注册并登录
      </el-button>
    </el-form>

    <p class="auth__switch">
      已有账号？
      <router-link :to="{ name: 'login' }">返回登录</router-link>
    </p>
  </AuthLayout>
</template>

<style scoped>
.auth__title {
  font-size: 19px;
  margin-bottom: 4px;
}

.auth__desc {
  font-size: 13px;
  color: var(--ink-500);
  margin-bottom: 22px;
}

.auth__alert {
  margin-bottom: 16px;
}

.auth__submit {
  width: 100%;
  margin-top: 8px;
}

.auth__switch {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-500);
}
</style>
