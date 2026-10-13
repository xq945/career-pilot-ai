import request from './request'

/**
 * 简历接口（《API接口设计》4.1–4.6）。
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

/**
 * 发起简历分析（4.5）：无请求体；同步调用通常 10–30 秒。
 *
 * AI 接口超时统一设 120 秒（《API接口设计》10.3：与后端总超时对齐）；
 * 每次调用都会重新分析并生成新版本（versionNo 递增，2026-10-13 起不再复用）。
 */
export function analyzeResume(id) {
  return request.post(`/resumes/${id}/analyze`, null, { timeout: 120000 })
}

/**
 * 获取最新一版简历分析（4.6）。
 *
 * 无分析结果时返回 HTTP 200 + `{ analyzed: false, analysis: null }`（不是 404），
 * 调用方据 `analyzed` 区分三态，不要把"未分析"当错误处理。
 */
export function getResumeAnalysis(id) {
  return request.get(`/resumes/${id}/analysis`)
}

/**
 * 下载简历原文件（4.7）：固定 `download=true`（附件下发，文件名取原始文件名）。
 *
 * 该接口的响应体是**文件二进制**（全项目唯一的非 JSON 成功响应），故用
 * `responseType: 'blob'` 接收；失败时后端仍返回统一结构的 JSON，
 * 由 request.js 的 normalizeErrorAsync 还原为业务错误（见那里的注释）。
 *
 * 原文按私有文件处理：带 JWT 经 /api 下发，不走 /uploads 静态路径。
 * 接口的预览形态（download=false）后端仍支持，界面自 V1.12 起不提供预览入口
 * （V1.13 曾以按钮加回、当日回退）。
 */
export function fetchResumeFile(id) {
  return request.get(`/resumes/${id}/file`, {
    params: { download: true },
    responseType: 'blob',
  })
}
