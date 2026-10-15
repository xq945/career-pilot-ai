<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { fetchCaptcha } from '@/api/auth'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useUserStore } from '@/stores/user'

/**
 * 登录页（《前端原型设计》§5.1）。
 *
 * 接口：GET /api/auth/captcha（加载即获取、点击图片刷新）、
 *       POST /api/auth/login，请求体 { account, password, captchaId, captchaCode }
 *       （account 可为用户名或邮箱）。
 */
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref()
const submitting = ref(false)
const errorMessage = ref('')

/**
 * 当前验证码。
 *
 * enabled 由取码接口下发（即后端 `app.captcha.enabled`），**初值为 false**：
 * 探测返回前不渲染验证码行，因此不存在"开关未知时被前端必填规则拦下"的竞态。
 * 关闭校验时整行始终不渲染，登录页与"没有验证码"时完全一致 —— 既有自动化脚本
 * （它们看不到图片、也不会填验证码）的 DOM 与元素索引不受任何影响。
 */
const captcha = reactive({ enabled: false, captchaId: '', imageBase64: '' })
const captchaLoading = ref(false)

/** 最近一次取码的进行中 Promise：提交前要等它结束，避免按未知的开关状态提交 */
let probing = null

const form = reactive({
  // 从注册页跳来时带上账号，省去重新输入
  account: typeof route.query.account === 'string' ? route.query.account : '',
  password: '',
  captchaCode: '',
})

const rules = {
  account: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  captchaCode: [
    {
      // 只在后端确实校验验证码时才必填（开关关闭时该行不渲染，规则必须随之失效）
      validator: (rule, value, callback) => {
        if (captcha.enabled && !value) {
          callback(new Error('请输入验证码'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

/**
 * 获取（或刷新）验证码。
 *
 * 刷新时把当前 captchaId 作为 replace 传给后端，让旧码立即失效
 * ——「验证码刷新后旧验证码不可继续使用」（《API接口设计》3.3）。
 *
 * 成功时**不动 errorMessage**，以免覆盖调用方刚设好的登录失败提示；
 * 取码失败则用它自己的提示盖掉（"后端连不上"比"验证码错误"更贴近真相）。
 */
function refreshCaptcha() {
  captchaLoading.value = true
  probing = fetchCaptcha(captcha.captchaId)
    .then((data) => {
      captcha.enabled = data.enabled
      captcha.captchaId = data.captchaId
      captcha.imageBase64 = data.imageBase64
      form.captchaCode = ''
    })
    .catch((error) => {
      // 后端不可达时这里最先暴露（比点击登录更早给出原因）
      captcha.enabled = false
      errorMessage.value = error.message || '验证码加载失败，请点击图片重试'
    })
    .finally(() => {
      captchaLoading.value = false
    })
  return probing
}

onMounted(refreshCaptcha)

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
  // 首次探测未结束就先等它（毫秒级）：否则开关状态未知，
  // 开着验证码时会被当成"无需验证码"提交，白跑一轮
  await probing

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await userStore.login({
      account: form.account.trim(),
      password: form.password,
      captchaId: captcha.captchaId,
      captchaCode: form.captchaCode,
    })
    ElMessage.success('登录成功')
    router.replace(resolveRedirect())
  }
  catch (error) {
    // 失败一律清空敏感输入、只保留账号：密码不回填，验证码本就是一次性的
    form.password = ''
    // 40100 时后端不区分"账号不存在"与"密码错误"（AuthService.login），
    // 前端也不得自行区分，否则等于把账号是否注册暴露出去（《前端原型设计》§5.1）。
    errorMessage.value = error.code === 40100 ? '用户名或密码错误，请重新输入' : error.message
    if (captcha.enabled) {
      // 验证码是一次性消费的：走到这里服务端已作废该 captchaId，不换新码的话
      // 下次提交必然 40002（哪怕用户只是改了个密码）—— 所以失败一律换图，不止 40002 时。
      await refreshCaptcha()
    }
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <h2 class="auth__title">欢迎回来</h2>

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

      <!-- 验证码行固定排在密码之后：登录页外的自动化脚本按**索引**定位输入框；
           用 v-if 而非 v-show，未渲染的 form-item 不注册字段，必填规则自然不生效 -->
      <el-form-item v-if="captcha.enabled" label="验证码" prop="captchaCode">
        <div class="auth__captcha">
          <el-input
            v-model="form.captchaCode"
            class="auth__captcha-input"
            placeholder="请输入验证码"
            maxlength="8"
            autocomplete="off"
            @keyup.enter="handleSubmit"
          />
          <img
            v-if="captcha.imageBase64"
            class="auth__captcha-img"
            :src="captcha.imageBase64"
            alt="验证码，点击刷新"
            title="点击刷新"
            @click="refreshCaptcha"
          >
        </div>
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

.auth__captcha {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

/* min-width: 0 不可省：否则 el-input 的最小宽度撑开 flex 行，把右侧图片挤出卡片 */
.auth__captcha-input {
  flex: 1;
  min-width: 0;
}

.auth__captcha-img {
  flex: 0 0 120px;
  width: 120px;
  height: 40px;
  display: block;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  cursor: pointer;
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
