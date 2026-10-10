import request from './request'

/**
 * 匹配接口（《API接口设计》6.1–6.3）。
 *
 * 所有接口的归属校验在后端完成（身份取自 Token），前端不传任何用户标识；
 * 他人匹配记录 ID 一律返回 404（不区分"不存在"与"无权访问"）。
 */

/**
 * 创建匹配分析（6.1）：**每次调用创建一条新记录**（保留历史，便于对比简历修改效果）。
 *
 * AI 接口超时统一设 120 秒（《API接口设计》10.3）：评分在后端本地计算、模型只生成
 * 解释与建议，通常耗时 5–20 秒。缺分析或岗位分析已过期 → 400（前端应在弹窗内就地拦截，
 * 不依赖后端报错）；模型超时/输出异常 → 502，本次不产生记录、可重试。
 */
export function createMatch({ resumeId, jobId }) {
  return request.post('/matches', { resumeId, jobId }, { timeout: 120000 })
}

/** 匹配记录列表（6.2）：created_at 倒序分页；内联资源名称与所用分析版本号 */
export function listMatches({ page = 1, size = 10 } = {}) {
  return request.get('/matches', { params: { page, size } })
}

/** 匹配报告详情（6.3）：响应结构与创建接口一致 */
export function getMatch(id) {
  return request.get(`/matches/${id}`)
}
