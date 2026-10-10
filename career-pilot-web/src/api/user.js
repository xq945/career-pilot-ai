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

/** 更新昵称（唯一可改字段，avatar 不在请求契约内，见《API接口设计》3.4） */
export function updateProfile(payload) {
  return request.put('/user/profile', payload)
}

/**
 * 上传头像（《API接口设计》3.6）。multipart 字段名 file。
 *
 * 不手动设置 Content-Type：boundary 由浏览器随 FormData 生成，
 * 手动设置会丢失 boundary 导致后端解析失败（《前端原型设计》7.2）。
 */
export function uploadAvatar(file) {
  const form = new FormData()
  form.append('file', file)
  return request.post('/user/avatar', form, { timeout: 60000 })
}

/** 移除头像（《API接口设计》3.7，幂等） */
export function removeAvatar() {
  return request.delete('/user/avatar')
}
