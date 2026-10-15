import request from './request'

/**
 * 面试日程接口（《API接口设计》§9A.1–§9A.7，M17）。
 *
 * 归属校验在后端完成（身份取自 Token）；解析两段式不落库；删除为物理删除。
 */

/**
 * 解析面试邀请（9A.1）：规则优先（0.95）+ AI 兜底（0.80）。
 *
 * **解析失败是正常业务态**（响应 `success: false` + 可读 message，HTTP 200）——
 * 页面据此引导手工填写，不弹全局错误；AI 兜底含 1 次模型调用，超时按 AI 口径 120 秒。
 */
export function parseScheduleInvitation(rawText) {
  return request.post('/interview-schedules/parse', { rawText }, { timeout: 120000 })
}

/** 创建日程（9A.2）：手工填写或确认解析结果（回传 parseSource / confidence） */
export function createSchedule(payload) {
  return request.post('/interview-schedules', payload)
}

/** 列表（9A.3）：默认按面试时间升序；status 筛选 + from/to 范围（日历按月拉取用） */
export function listSchedules({ page = 1, size = 10, status, from, to } = {}) {
  return request.get('/interview-schedules', { params: { page, size, status, from, to } })
}

/** 详情（9A.4） */
export function getSchedule(id) {
  return request.get(`/interview-schedules/${id}`)
}

/** 更新（9A.5，全量）：仅 PENDING 可编辑 */
export function updateSchedule(id, payload) {
  return request.put(`/interview-schedules/${id}`, payload)
}

/** 状态流转（9A.6）：COMPLETED / CANCELLED（EXPIRED 不接受用户写入） */
export function updateScheduleStatus(id, status) {
  return request.put(`/interview-schedules/${id}/status`, { status })
}

/** 删除（9A.7）：物理删除 */
export function deleteSchedule(id) {
  return request.delete(`/interview-schedules/${id}`)
}
