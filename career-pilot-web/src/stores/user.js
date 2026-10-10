import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as authApi from '@/api/auth'
import * as userApi from '@/api/user'
import { useAgentStore } from '@/stores/agent'
import { clearAuth, readToken, readUser, writeAuth, writeUser } from '@/utils/authStorage'

/**
 * 用户认证状态（《前端原型设计》8.3 节：Pinia 只存跨页面共享的状态）。
 *
 * 状态的双份存放是有意的：
 * - 内存（ref）：供组件响应式读取；
 * - localStorage：供刷新页面后恢复（同一份数据，由 utils/authStorage 统一读写）。
 */
export const useUserStore = defineStore('user', () => {
  const token = ref(readToken())

  const user = ref(readUser())

  /** 是否已加载过当前用户资料。用于区分"尚未恢复"与"已确认未登录" */
  const profileLoaded = ref(false)

  const isLoggedIn = computed(() => Boolean(token.value))

  /** 顶栏展示用：昵称优先，无昵称退回用户名 */
  const displayName = computed(() => user.value?.nickname || user.value?.username || '')

  /** 头像占位字符：取显示名首字符 */
  const initial = computed(() => displayName.value.charAt(0) || '?')

  /**
   * 登录：写入 Token 与用户资料。
   *
   * 登录响应已包含 UserProfile（LoginResponse.user），无需再调 /user/profile。
   */
  async function login(credentials) {
    const data = await authApi.login(credentials)
    token.value = data.token
    user.value = data.user
    profileLoaded.value = true
    writeAuth(data.token, data.user)
    return data
  }

  /**
   * 注册。
   *
   * 注册接口只返回 UserProfile、**不返回 Token**，因此这里只完成注册本身；
   * 「注册并登录」的体验由调用方接着调 login 完成（与原型按钮文案一致）。
   */
  async function register(form) {
    return authApi.register(form)
  }

  /** 重新拉取用户资料（刷新页面恢复登录态时使用） */
  async function fetchProfile() {
    const profile = await userApi.getProfile()
    user.value = profile
    profileLoaded.value = true
    writeUser(profile)
    return profile
  }

  /**
   * 资料写操作的统一收口：接口响应即完整 UserProfile，
   * 直接替换内存状态并同步 localStorage（顶栏与页面即时更新）。
   */
  function applyProfile(profile) {
    user.value = profile
    writeUser(profile)
    return profile
  }

  /** 更新昵称 */
  async function updateProfile(nickname) {
    return applyProfile(await userApi.updateProfile({ nickname }))
  }

  /** 上传头像（即时生效，不随「保存修改」提交） */
  async function changeAvatar(file) {
    return applyProfile(await userApi.uploadAvatar(file))
  }

  /** 移除头像 */
  async function removeAvatar() {
    return applyProfile(await userApi.removeAvatar())
  }

  /** 清空本地登录态。401 统一处理与退出登录共用 */
  function reset() {
    token.value = null
    user.value = null
    profileLoaded.value = false
    clearAuth()
    // 智能体对话是账号私有数据：换账号后不能残留上一个人的会话与消息
    useAgentStore().reset()
  }

  /**
   * 退出登录。
   *
   * 服务端不实现 Token 撤销（《API接口设计》3.5），本地清除才是真正的登出动作；
   * 因此接口调用失败（如后端已不可达）不应阻塞退出，静默忽略即可。
   */
  async function logout() {
    try {
      await authApi.logout()
    }
    catch {
      // 忽略：本地退出不依赖服务端
    }
    reset()
  }

  /**
   * 刷新页面后恢复登录态，由路由守卫在首次进入受保护路由时调用。
   *
   * 返回值：
   * - `true`  资料已取回，登录有效；
   * - `false` Token 被后端判定为无效（401），本地状态已清除；
   * - `null`  未能确认（网络不可达等原因），**保留**本地登录态，交由页面提示错误。
   *
   * 不区分后两种会导致"后端没启动时用户被莫名踢下线"。
   */
  async function restore() {
    if (!token.value) {
      return false
    }
    try {
      await fetchProfile()
      return true
    }
    catch (error) {
      if (error.code === 40100) {
        // 拦截器已清除 localStorage，这里同步内存状态
        reset()
        return false
      }
      return null
    }
  }

  return {
    token,
    user,
    profileLoaded,
    isLoggedIn,
    displayName,
    initial,
    login,
    register,
    fetchProfile,
    updateProfile,
    changeAvatar,
    removeAvatar,
    logout,
    reset,
    restore,
  }
})
