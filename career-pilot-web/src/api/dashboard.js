import request from './request'

/**
 * 工作台接口（《API接口设计》9.1）。
 *
 * 只读、只服务工作台单一页面：统计卡计数、最近匹配记录（5 条）与能力差距（最多 3 条）
 * 都来自本接口；另外三组最近记录（简历 / 优化 / 面试）由各自模块的分页列表接口按
 * `size=5` 取——**共 4 个并行请求、分区容错**（见 DashboardView.vue 的说明）。
 * 全部统计带 user_id 过滤（身份取自 Token），前端不传任何用户标识。
 */

/** 工作台总览（9.1）：四类计数 + 最近匹配（5 条）+ 能力差距（最多 3 条） */
export function getDashboardSummary() {
  return request.get('/dashboard/summary')
}
