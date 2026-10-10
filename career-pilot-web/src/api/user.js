import request from './request'

/**
 * 用户接口（《API接口设计》3.3）。
 *
 * 注意：接口不接受 userId 参数，身份一律由后端从 Token 中解析
 * （UserController 用 CurrentUser.requireId()）。前端**不得**为"查看某用户资料"
 * 而尝试传参，越权访问在后端即被拒绝。
 */

/** 读取当前用户资料 */
export function getProfile() {
  return request.get('/user/profile')
}
