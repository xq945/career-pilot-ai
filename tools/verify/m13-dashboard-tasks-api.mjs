/**
 * M13 工作台聚合接口层验收（《开发顺序》M13；《一体化工作流收口方案》§5.1）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M13 的新实例**）、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**5 次真实模型调用**（简历分析 1 + 岗位分析 1 + 创建优化 2 + 出题 1）。
 *
 * 覆盖（《API接口设计》§9.1 的 recentTasks 契约）：
 * - 新账号：recentTasks 为空数组；
 * - 四类任务逐步出现，`type` / `refId` / `title` 正确（优化为「{简历名} · {岗位名}」）；
 * - 按 `happenedAt` 倒序；
 * - `recentMatches` 字段保留（兼容），`topGaps` 等既有字段不受影响。
 *
 * 「每类 ≤3、合并 ≤6」的截断口径由 DashboardServiceTest 单测钉住
 * （真库构造 7+ 条任务需多轮模型调用，成本不成比例）。
 *
 * 运行：node tools/verify/m13-dashboard-tasks-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

/** 验收专用密码（满足 8 位且含字母与数字的注册规则） */
const PASSWORD = 'verify1234'

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  [OK] ${name}`)
  } else {
    failures.push(detail ? `${name} — ${detail}` : name)
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  let payload
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ---------------------------------------------------------------- 测试数据

const SUFFIX = Date.now().toString(36)

const JOB_NAME = 'M13 验收岗位'
const RESUME_NAME = 'M13 验收简历'

const RESUME_TEXT = [
  '张三 / Java 后端开发',
  '技能：Java、Spring Boot、MySQL、Redis',
  '项目经历：校园二手交易平台（后端负责人），使用 Java 与 Spring Boot 实现订单模块',
  '教育经历：示例大学 计算机科学与技术 本科（2021-2025）',
].join('\n')

const JOB_TEXT = [
  '岗位名称：Java 后端开发实习生',
  '职责：参与核心业务系统的接口开发与维护。',
  '要求：熟悉 Java、Spring Boot、MySQL；了解 Redis。',
].join('\n')

const summaryOf = async (token) => (await api('GET', '/dashboard/summary', { token })).body?.data

async function main() {
  console.log(`接口层验收（后端 ${BASE}）\n`)

  const username = `m13_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  const token = login.body?.data?.token
  check('账号注册与登录成功', Boolean(token))
  if (!token) {
    return
  }

  // ------------------------------------------------------------ 组 1：新账号空数组

  console.log('\n== 组 1：新账号 ==')
  const empty = await summaryOf(token)
  check('新账号 recentTasks 为空数组', Array.isArray(empty?.recentTasks) && empty.recentTasks.length === 0,
    JSON.stringify(empty?.recentTasks))

  // ------------------------------------------------------------ 组 2：分析类任务

  console.log('\n== 组 2：简历 / 岗位分析（2 次模型调用） ==')
  const form = new FormData()
  form.append('name', RESUME_NAME)
  form.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
  const resumeId = (await api('POST', '/resumes', { token, form })).body?.data?.id
  const jobId = (await api('POST', '/jobs', {
    token,
    body: { jobName: JOB_NAME, companyName: '验收科技', description: JOB_TEXT },
  })).body?.data?.id
  const resumeAnalysis = await api('POST', `/resumes/${resumeId}/analyze`, { token })
  const jobAnalysis = await api('POST', `/jobs/${jobId}/analyze`, { token })
  check('简历与岗位分析完成', resumeAnalysis.body?.code === 0 && jobAnalysis.body?.code === 0)

  const afterAnalysis = await summaryOf(token)
  const tasks2 = afterAnalysis?.recentTasks ?? []
  check('两条分析任务出现（岗位分析在前，时间倒序）',
    tasks2.length === 2 && tasks2[0].type === 'JOB_ANALYSIS' && tasks2[1].type === 'RESUME_ANALYSIS'
      && tasks2[0].refId === jobId && tasks2[1].refId === resumeId,
    JSON.stringify(tasks2))
  check('分析任务标题为资源名',
    tasks2[0]?.title === JOB_NAME && tasks2[1]?.title === RESUME_NAME,
    JSON.stringify(tasks2.map((t) => t.title)))

  // ------------------------------------------------------------ 组 3：优化任务

  console.log('\n== 组 3：创建优化（2 次模型调用，25–80 秒） ==')
  const optimization = await api('POST', '/optimizations', { token, body: { resumeId, jobId } })
  const optimizationId = optimization.body?.data?.id
  check('创建优化成功', optimization.body?.code === 0 && Boolean(optimizationId),
    optimization.body?.message)
  if (!optimizationId) {
    return
  }

  const afterOptimization = await summaryOf(token)
  const tasks3 = afterOptimization?.recentTasks ?? []
  check('优化任务位于首位（type / refId / 标题）',
    tasks3.length === 3 && tasks3[0].type === 'OPTIMIZATION'
      && tasks3[0].refId === optimizationId
      && tasks3[0].title === `${RESUME_NAME} · ${JOB_NAME}`,
    JSON.stringify(tasks3[0]))
  check('与优化详情交叉核对（refId 指向真实记录）',
    (await api('GET', `/optimizations/${tasks3[0].refId}`, { token })).body?.code === 0)

  // ------------------------------------------------------------ 组 4：面试任务

  console.log('\n== 组 4：创建面试（1 次模型调用，10–40 秒） ==')
  const interview = await api('POST', '/interviews', {
    token,
    body: { jobId, title: 'M13 验收面试', questionType: 'MIXED', questionCount: 2 },
  })
  const sessionId = interview.body?.data?.id
  check('创建面试成功', interview.body?.code === 0 && Boolean(sessionId), interview.body?.message)
  if (!sessionId) {
    return
  }

  const afterInterview = await summaryOf(token)
  const tasks4 = afterInterview?.recentTasks ?? []
  check('面试任务位于首位（type / refId / 标题）',
    tasks4.length === 4 && tasks4[0].type === 'INTERVIEW' && tasks4[0].refId === sessionId
      && tasks4[0].title === 'M13 验收面试',
    JSON.stringify(tasks4[0]))
  check('四类任务齐全',
    ['INTERVIEW', 'OPTIMIZATION', 'JOB_ANALYSIS', 'RESUME_ANALYSIS']
      .every((type) => tasks4.some((task) => task.type === type)),
    JSON.stringify(tasks4.map((t) => t.type)))
  check('按 happenedAt 倒序',
    tasks4.every((task, index) => index === 0 || tasks4[index - 1].happenedAt >= task.happenedAt),
    JSON.stringify(tasks4.map((t) => t.happenedAt)))

  // ------------------------------------------------------------ 组 5：兼容字段

  console.log('\n== 组 5：既有字段兼容 ==')
  check('recentMatches 保留且 recentMatches[0] 指向本次优化写的匹配记录',
    Array.isArray(afterInterview?.recentMatches) && afterInterview.recentMatches.length >= 1
      && afterInterview.recentMatches[0].resumeId === resumeId
      && afterInterview.recentMatches[0].jobId === jobId,
    JSON.stringify(afterInterview?.recentMatches?.[0]))
  check('既有计数字段不受影响（四类计数与数据一致）',
    afterInterview?.resumeCount === 1 && afterInterview?.jobCount === 1
      && afterInterview?.interviewCount === 1,
    JSON.stringify({ r: afterInterview?.resumeCount, j: afterInterview?.jobCount,
      i: afterInterview?.interviewCount }))
}

main()
  .then(() => {
    console.log(`\n结果：通过 ${passed} 项，失败 ${failures.length} 项`)
    if (failures.length) {
      failures.forEach((item) => console.log(`  - ${item}`))
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('脚本异常：', error)
    process.exit(1)
  })
