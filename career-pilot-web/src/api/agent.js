import request from './request'

/**
 * 求职智能体接口（《API接口设计》§8）。
 *
 * 工具的原始入参与结果不对外暴露：`toolCalls` 与消息里的 tool 行都只有工具名与状态。
 * 归属校验在后端完成（身份取自 Token）；他人会话/资源 ID 一律 404。
 */

/**
 * 对话（§8.1）：**非流式**——整体等待后一次性返回。
 *
 * 超时取 200 秒：后端契约是「总时长 ≤120 秒」，但截止时间在**工具执行边界**强制
 * （整轮是阻塞调用，无法硬中断在途的 HTTP 读），最坏墙钟 ≈120 秒 + 一次在途模型调用；
 * 取 200 秒保证请求不会先于后端返回而本地超时。
 *
 * `truncated = true` 表示达到工具次数/总时长上限，回答可能不完整（前端提示即可，非错误）。
 */
export function chatAgent({ sessionId, message, resumeId, jobId }) {
  return request.post(
    '/agent/chat',
    { sessionId, message, resumeId, jobId },
    { timeout: 200000 },
  )
}

/** 会话列表（§8.2）：按最近活跃（updated_at）倒序，含三类消息的消息数 */
export function listAgentSessions({ page = 1, size = 10 } = {}) {
  return request.get('/agent/sessions', { params: { page, size } })
}

/** 会话消息回看（§8.3）：created_at 升序、第一版不分页；tool 消息只有 toolName 与 status */
export function getAgentSession(sessionId) {
  return request.get(`/agent/sessions/${sessionId}`)
}
