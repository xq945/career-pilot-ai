import request from './request'

/**
 * 认证接口（《API接口设计》3.1、3.2、3.3、3.5）。
 *
 * 请求体字段以后端 DTO 为准：
 * - 注册：RegisterRequest { username, email, password }
 * - 登录：LoginRequest   { account, password, captchaId, captchaCode }，account 可为用户名或邮箱
 */

/** 注册。成功返回 UserProfile，**不含 Token** —— 需要登录态时须再调 login */
export function register({ username, email, password }) {
  return request.post('/auth/register', { username, email, password })
}

/**
 * 获取图形验证码（M18）。成功返回 { captchaId, imageBase64, expiresIn, enabled }，
 * 其中 imageBase64 是带 `data:image/png;base64,` 前缀的完整 data URI，可直接用作 img 的 src。
 *
 * @param replace 传当前 captchaId 时，后端生成新码的同时**立即作废**它（刷新场景）
 */
export function fetchCaptcha(replace) {
  return request.get('/auth/captcha', { params: replace ? { replace } : {} })
}

/** 登录。成功返回 { token, tokenType, expiresIn, user } */
export function login({ account, password, captchaId, captchaCode }) {
  return request.post('/auth/login', { account, password, captchaId, captchaCode })
}

/**
 * 退出登录。
 *
 * 服务端不实现 Token 撤销机制（《API接口设计》3.5），该接口仅表示客户端应清除本地 Token，
 * 调用成功与否都不影响本地退出。
 */
export function logout() {
  return request.post('/auth/logout')
}
