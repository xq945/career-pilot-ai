import request from './request'

/**
 * 简历定向优化接口（《API接口设计》§6A.1–§6A.6）。
 *
 * 所有接口的归属校验在后端完成（身份取自 Token），前端不传任何用户标识；
 * 他人优化记录 ID 一律返回 404（不区分"不存在"与"无权访问"）。
 */

/**
 * 创建优化（6A.1）：**每次调用创建一条新记录**（同一简历+岗位的 versionNo 递增）。
 *
 * 同步调用，通常耗时 **25–80 秒**（匹配解释 + 优化生成共 2 次模型调用），
 * 前端超时按 300 秒设置（§10.3 的唯一例外）。缺分析或岗位分析已过期 → 400
 * （前端应在弹窗内就地拦截，不依赖后端报错）；模型超时/输出异常 → 502，
 * 本次不产生优化记录、可重试。
 *
 * 手动输入 JD 的场景由页面编排：先 POST /api/jobs 与 POST /api/jobs/{id}/analyze
 * 建岗位并分析，再调用本接口（每步独立超时、进度可见）。
 */
export function createOptimization({ resumeId, jobId }) {
  return request.post('/optimizations', { resumeId, jobId }, { timeout: 300000 })
}

/** 优化记录列表（6A.2）：created_at 倒序分页；内联资源名称与优化前后分数 */
export function listOptimizations({ page = 1, size = 10 } = {}) {
  return request.get('/optimizations', { params: { page, size } })
}

/** 优化详情（6A.3）：响应结构与创建接口一致（含 editHistory，供历史版本抽屉） */
export function getOptimization(id) {
  return request.get(`/optimizations/${id}`)
}

/**
 * 保存用户编辑稿（6A.4）：写入 editedContent，**不覆盖**模型原稿 optimizedContent；
 * 内容与当前稿一致时后端不写库、不产生历史版本。失败：空白/超长 → 40001。
 */
export function saveOptimizationContent(id, content) {
  return request.put(`/optimizations/${id}/content`, { content })
}

/**
 * 重新评估优化后匹配度（6A.5）：对优化稿重新做结构化分析后按同一规则重算，
 * 通常 10–30 秒；每次调用真重跑（不复用）。失败 502 时不改变原有评估结果。
 */
export function evaluateOptimization(id) {
  return request.post(`/optimizations/${id}/evaluate`, null, { timeout: 120000 })
}

/**
 * 导出优化稿 DOCX（6A.6）。
 *
 * 响应体是**文件二进制**（全项目第二个非 JSON 成功响应），用 responseType: 'blob' 接收；
 * 失败时后端仍返回统一结构的 JSON，由 request.js 的 normalizeErrorAsync 还原为业务错误。
 * 注意：响应拦截器只把 data 交给调用方，**拿不到响应头的文件名**——
 * 文件名由调用方按 `{简历名}-{岗位名}-优化稿.docx` 规则自行构造（与后端命名一致）。
 */
export function exportOptimization(id) {
  return request.get(`/optimizations/${id}/export`, { responseType: 'blob' })
}
