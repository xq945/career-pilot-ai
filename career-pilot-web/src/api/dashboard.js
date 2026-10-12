import request from './request'

/**
 * 仪表盘接口（《API接口设计》9.1）。
 *
 * 只读、只服务仪表盘单一页面：整页**只发这一个请求**，准备清单六步的完成状态
 * 由返回的计数字段推导（《前端原型设计》5.2 的实现提示）。
 * 全部统计带 user_id 过滤（身份取自 Token），前端不传任何用户标识。
 */

/** 求职准备总览（9.1）：四类计数 + 最近匹配（5 条）+ 能力差距（最多 3 条） */
export function getDashboardSummary() {
  return request.get('/dashboard/summary')
}
