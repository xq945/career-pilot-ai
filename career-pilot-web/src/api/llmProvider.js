import request from './request'

/**
 * 模型服务接口（《API接口设计》§3A.1–§3A.6，M14）。
 *
 * 归属校验在后端完成（身份取自 Token），前端不传任何用户标识；
 * API Key 只回显掩码（maskedApiKey），任何响应不携带明文或密文。
 */

/** 服务列表（3A.1）：首次访问时后端会懒初始化内置三家（deepseek 为默认） */
export function listLlmProviders() {
  return request.get('/llm-providers')
}

/** 新增自定义服务（3A.2）：OpenAI 兼容协议；apiKey 必填，服务端加密落库 */
export function createLlmProvider({ displayName, baseUrl, model, apiKey, temperature }) {
  return request.post('/llm-providers', { displayName, baseUrl, model, apiKey, temperature })
}

/** 更新服务（3A.3）：字段缺省或空串 = 不修改（apiKey 留空 = 保留原 Key） */
export function updateLlmProvider(id, payload) {
  return request.put(`/llm-providers/${id}`, payload)
}

/** 删除服务（3A.4）：内置不可删、当前默认不可删（均 400 且提示原因） */
export function deleteLlmProvider(id) {
  return request.delete(`/llm-providers/${id}`)
}

/**
 * 连通性测试（3A.5）：1 次最小真实调用，通常 1–10 秒。
 *
 * **失败返回 ok:false 而非 502**（失败是预期结果，由页面就地展示），
 * 前端超时按 AI 调用口径 120 秒。
 */
export function testLlmProvider(id) {
  return request.post(`/llm-providers/${id}/test`, null, { timeout: 120000 })
}

/** 切换默认服务（3A.6）：校验已启用且已配置 Key；切换后后续 AI 调用立即生效 */
export function setDefaultLlmProvider(id) {
  return request.put(`/llm-providers/${id}/default`)
}
