import axios from 'axios'

/**
 * Axios 实例。
 *
 * 约定依据《系统架构设计》：
 * - 7.2 节：开发环境前后端分离部署，后端已配置 CORS，前端直接使用完整地址；
 * - 7.3 节：JWT 存放于 localStorage，请求时通过 Authorization 头携带。
 */
const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api',
  timeout: 30000,
})

// 请求拦截器：携带 JWT
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：统一错误处理
request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // TODO: 接入《API 接口设计》的统一响应结构与业务错误码
    // 401 时清除本地 Token 并跳转登录页
    return Promise.reject(error)
  },
)

export default request
