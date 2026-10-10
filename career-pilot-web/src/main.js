import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// 顺序有意义：组件库样式在前，本地样式在后，
// 否则 tokens.css 里的主题变量覆盖会被 Element Plus 的默认值盖回去。
import 'element-plus/dist/index.css'
import '@/styles/tokens.css'
import '@/styles/base.css'

import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from '@/api/request'
import { useUserStore } from '@/stores/user'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

/**
 * 401 统一处理（《前端原型设计》§7.1）：清除本地凭据 → 跳转登录页 → 提示。
 *
 * 用回调注入而非在 api/request.js 中直接 import router/store：后者的依赖方向是
 * store → api → request，若 request 反过来依赖 router 与 store 会形成循环依赖。
 */
setUnauthorizedHandler(() => {
  const userStore = useUserStore(pinia)
  userStore.reset()

  const current = router.currentRoute.value
  if (current.name === 'login') {
    // 已经停在登录页（例如页面停留期间 Token 过期后的一次轮询请求），
    // 无需再跳转，也不该用"登录已过期"覆盖用户正在看的登录提示。
    return
  }

  router.replace({ name: 'login', query: { redirect: current.fullPath } })
  ElMessage.error('登录已过期，请重新登录')
})

app.mount('#app')
