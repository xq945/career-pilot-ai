import axios from 'axios'

import { clearAuth, readToken } from '@/utils/authStorage'

/**
 * Axios 实例与统一响应处理。
 *
 * 约定依据：
 * - 《系统架构设计》7.2 节：开发环境前后端分离部署，后端已配置 CORS，前端直接使用完整地址；
 * - 《系统架构设计》7.3 节：JWT 存放于 localStorage，请求时通过 Authorization 头携带；
 * - 《API接口设计》1 节：响应统一为 { code, message, data, timestamp }，code = 0 为成功；
 * - 《前端原型设计》7.1 节：业务错误码与前端处理方式的对应表。
 */
const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api',
  // 默认超时。AI 相关接口（分析、匹配、出题、对话）需按《前端原型设计》7.2 节
  // 单独传 120 秒，截止本次实现尚未有此类接口。
  timeout: 30000,
})

/** 未取得后端业务码时的本地错误码（网络不可达、超时等） */
export const LOCAL_ERROR_CODE = -1

/**
 * 登录与注册接口的 URL。这两个接口的 401 表示"账号或密码错误"（见
 * AuthService.login），而不是"登录已过期"。必须排除在下面的 401 统一处理之外，
 * 否则用户输错密码会被当成会话过期、跳转登录页并丢失已填表单。
 */
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/register']

/** 401 统一处理的回调，由 main.js 在应用初始化时注入（避免 request → router 的循环依赖） */
let unauthorizedHandler = null

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

function isCredentialRequest(url = '') {
  return CREDENTIAL_ENDPOINTS.some((endpoint) => url.includes(endpoint))
}

/** 把 axios 错误与业务错误统一成 { code, message, data, httpStatus } 结构 */
function normalizeError(error) {
  const response = error.response

  // 后端返回了统一响应结构（40000、40001、40100、40300……）
  if (response && response.data && typeof response.data.code === 'number') {
    return {
      code: response.data.code,
      message: response.data.message,
      data: response.data.data,
      httpStatus: response.status,
    }
  }

  // 后端返回了响应但不是统一结构（如反向代理的错误页）
  if (response) {
    return {
      code: LOCAL_ERROR_CODE,
      message: `请求失败（HTTP ${response.status}）`,
      data: null,
      httpStatus: response.status,
    }
  }

  // 没有响应：超时、连接被拒、跨域失败等
  if (error.code === 'ECONNABORTED') {
    return {
      code: LOCAL_ERROR_CODE,
      message: '请求超时，请稍后重试',
      data: null,
      httpStatus: null,
    }
  }

  return {
    code: LOCAL_ERROR_CODE,
    // 开发环境最常见的原因是后端未启动，提示里点出来可省一轮排查
    message: '无法连接服务器，请确认后端服务已启动',
    data: null,
    httpStatus: null,
  }
}

/**
 * blob 请求（如简历文件下载）出错时，响应体被 axios 按响应类型解析成 Blob，
 * 而它内部其实是统一结构的 JSON——先读回文本再解析，否则业务错误码与文案会丢失
 * （表现为只有「请求失败（HTTP 404）」）。
 */
async function parseBlobBody(blob) {
  try {
    const body = JSON.parse(await blob.text())
    return body && typeof body === 'object' ? body : null
  }
  catch {
    return null
  }
}

/** 错误规范化的异步版本：仅多一步 Blob 响应体的还原，其余走同步逻辑 */
async function normalizeErrorAsync(error) {
  const response = error?.response
  if (response && response.data instanceof Blob) {
    return normalizeError({ ...error, response: { ...response, data: await parseBlobBody(response.data) } })
  }
  return normalizeError(error)
}

// 请求拦截器：携带 JWT
request.interceptors.request.use((config) => {
  const token = readToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：拆统一响应结构，失败时抛出规范化错误
request.interceptors.response.use(
  (response) => {
    const body = response.data

    // 统一响应结构：成功时直接把 data 交给调用方，省去各处的 body.data
    if (body && typeof body === 'object' && typeof body.code === 'number') {
      if (body.code === 0) {
        return body.data
      }
      // 兜底：HTTP 200 但业务码非 0（当前后端不会这样返回，防御性处理）
      return Promise.reject(normalizeError({ response: { ...response, data: body } }))
    }

    // 非统一结构（理论上后端不会返回）
    return body
  },
  async (error) => {
    const apiError = await normalizeErrorAsync(error)

    // 401 且不是登录/注册请求 → 说明 Token 失效（过期、被篡改、后端换了密钥）。
    // 清除本地凭据并交给应用层跳转登录页（《前端原型设计》7.1）。
    if (apiError.httpStatus === 401 && !isCredentialRequest(error.config?.url)) {
      clearAuth()
      unauthorizedHandler?.(apiError)
    }

    return Promise.reject(apiError)
  },
)

export default request
