import request from './request'

/**
 * 认证接口（《API接口设计》3.1、3.2、3.5）。
 *
 * 请求体字段以后端 DTO 为准：
 * - 注册：RegisterRequest { username, email, password }
 * - 登录：LoginRequest   { account, password }，account 可为用户名或邮箱
 */

/** 注册。成功返回 UserProfile，**不含 Token** —— 需要登录态时须再调 login */
export function register({ username, email, password }) {
  return request.post('/auth/register', { username, email, password })
}

/** 登录。成功返回 { token, tokenType, expiresIn, user } */
export function login({ account, password }) {
  return request.post('/auth/login', { account, password })
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
