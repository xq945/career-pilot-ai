import request from './request'

/**
 * 面试接口（《API接口设计》§7）。
 *
 * 所有接口的归属校验在后端完成（身份取自 Token），前端不传任何用户标识；
 * 他人会话/题目 ID 一律返回 404（不区分"不存在"与"无权访问"）。
 */

/** 题型选项（六选一，与后端白名单一致；顺序对齐设计文档） */
export const QUESTION_TYPES = [
  { value: 'MIXED', label: '综合' },
  { value: 'JAVA', label: 'Java 基础' },
  { value: 'SPRING', label: 'Spring 框架' },
  { value: 'MYSQL', label: 'MySQL' },
  { value: 'REDIS', label: 'Redis' },
  { value: 'PROJECT', label: '项目经历' },
]

/** 题型 code → 中文标签 */
export const TYPE_LABELS = Object.fromEntries(QUESTION_TYPES.map((item) => [item.value, item.label]))

const CATEGORY_LABELS = { ...TYPE_LABELS }

/** 题目类别 → 中文；模型未给出类别（null）时显示「未分类」 */
export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? '未分类'
}

/**
 * 创建面试会话（§7.1）：题目随会话一次性生成，同步调用通常 10–40 秒。
 *
 * AI 接口超时统一设 120 秒（《API接口设计》10.3）；生成失败（50200/50201）
 * **不产生空会话**，可直接重试。实际题数可能少于请求的 questionCount（去重后以实际为准），
 * 响应中的 generatedCount 才是落库题数。
 */
export function createInterview({ jobId, title, questionType, questionCount }) {
  return request.post('/interviews', { jobId, title, questionType, questionCount }, { timeout: 120000 })
}

/** 面试列表（§7.3）：created_at 倒序分页；内联岗位名称与 generatedCount / answeredCount */
export function listInterviews({ page = 1, size = 10 } = {}) {
  return request.get('/interviews', { params: { page, size } })
}

/** 面试详情（§7.3）：会话信息 + 全部题目（含已提交的回答与评价），按 sortOrder 升序 */
export function getInterview(id) {
  return request.get(`/interviews/${id}`)
}

/**
 * 提交回答并评价（§7.2）：同步调用通常 10–30 秒；重复提交覆盖上一次评价（得分以最后一次为准）。
 *
 * 评价失败（50200/50201）**整体不入库**，调用方必须保留用户输入供重试；
 * 本次提交使会话完成时，服务端会额外生成总评（响应返回前完成，耗时可能更长）。
 */
export function submitAnswer(sessionId, questionId, answer) {
  return request.post(
    `/interviews/${sessionId}/questions/${questionId}/answer`,
    { answer },
    { timeout: 120000 },
  )
}

/**
 * 面试报告（§7.4）：总分与总评**直接取已写入的值**；未完成时 `completed = false`、
 * `totalScore` 与总评字段均为 null。报告响应已含头部字段（岗位/题型/完成时间），
 * 报告页单请求即可，无需再拉详情。
 */
export function getInterviewReport(id) {
  return request.get(`/interviews/${id}/report`)
}
