<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import AuthLayout from '@/layouts/AuthLayout.vue'
import { useUserStore } from '@/stores/user'

/**
 * 登录页（《前端原型设计》§5.1）。
 *
 * 接口：POST /api/auth/login，请求体 { account, password }（account 可为用户名或邮箱）。
 */
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref()
const submitting = ref(false)
const errorMessage = ref('')

const form = reactive({
  // 从注册页跳来时带上账号，省去重新输入
  account: typeof route.query.account === 'string' ? route.query.account : '',
  password: '',
})

const rules = {
  account: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/**
 * 登录后的落地地址。
 *
 * 只接受站内路径：`redirect` 来自 URL，若直接交给 router 使用，形如
 * `//evil.com` 的值可能被当作协议相对地址造成开放重定向。
 */
function resolveRedirect() {
  const target = route.query.redirect
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')) {
    return target
  }
  return '/dashboard'
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await userStore.login({ account: form.account.trim(), password: form.password })
    ElMessage.success('登录成功')
    router.replace(resolveRedirect())
  }
  catch (error) {
    // 40100 时后端不区分"账号不存在"与"密码错误"（AuthService.login），
    // 前端也不得自行区分，否则等于把账号是否注册暴露出去（《前端原型设计》§5.1）。
    errorMessage.value = error.code === 40100 ? '用户名或密码错误，请重新输入' : error.message
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <h2 class="auth__title">欢迎回来</h2>
    <p class="auth__desc">使用用户名或邮箱登录你的账号</p>

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
      <el-form-item label="账号" prop="account">
        <el-input
          v-model="form.account"
          placeholder="用户名或邮箱"
          autocomplete="username"
          @keyup.enter="handleSubmit"
        />
      </el-form-item>

      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
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
        登录
      </el-button>
    </el-form>

    <p class="auth__switch">
      还没有账号？
      <router-link :to="{ name: 'register' }">立即注册</router-link>
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
