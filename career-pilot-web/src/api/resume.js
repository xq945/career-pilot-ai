import request from './request'

/**
 * 简历接口（《API接口设计》4.1–4.4）。
 *
 * 所有接口的归属校验在后端完成（身份取自 Token），前端不传任何用户标识；
 * 他人简历 ID 一律返回 404（不区分"不存在"与"无权访问"）。
 */

/** 简历列表（4.2）：仅本人有效简历，响应 { records, page, size, total } */
export function listResumes({ page = 1, size = 10 } = {}) {
  return request.get('/resumes', { params: { page, size } })
}

/** 简历详情（4.3）：不含提取文本与存储路径 */
export function getResume(id) {
  return request.get(`/resumes/${id}`)
}

/**
 * 上传简历（4.1）。multipart 字段：file（必填）、name（可选，≤ 100 字符）。
 *
 * 不手动设置 Content-Type：boundary 由浏览器随 FormData 生成，
 * 手动设置会丢失 boundary 导致后端解析失败（《前端原型设计》7.2）；
 * 上传接口超时 ≥ 60 秒（服务端同步完成文件保存与文本提取）。
 */
export function uploadResume(file, name) {
  const form = new FormData()
  form.append('file', file)
  if (name) {
    form.append('name', name)
  }
  return request.post('/resumes', form, { timeout: 60000 })
}

/** 删除简历（4.4）：逻辑删除 + 服务端物理删除文件；重复删除幂等成功 */
export function removeResume(id) {
  return request.delete(`/resumes/${id}`)
}
