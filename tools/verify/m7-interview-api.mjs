/**
 * M7 面试模块接口层验收（《开发顺序》M7 的「curl 验收」环节；用 Node fetch 实现等价的用例组，
 * 与 curl 手敲相比可复现、可断言、可重跑，断言内容与 curl 用例一一对应）。
 *
 * 覆盖 A/B/C 三组：主链路（出题 → 评价 → 完成 → 总评 → 报告 → 重答即时重算）、
 * 边界校验、越权矩阵。**502 失败态**需以受限配置启动后端，见 m7-ai-timeout.mjs。
 *
 * 前置：后端已在 8080 运行、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**5 次真实模型调用**（出题 2 + 评价 2 + 总评 1）——题目数刻意取小以控制消耗。
 *
 * 运行：node tools/verify/m7-interview-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 *
 * 注：「报告只读、不做惰性计算」的护栏（库值与题目平均不一致时返回库值）由
 * InterviewServiceTest.report_returnsWrittenTotalScoreWithoutRecomputing 单测钉住——
 * 脚本无法从外部制造"库值 ≠ 题目平均"的状态，故不在此重复。
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

async function api(method, path, { token, body } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ---------------------------------------------------------------- 测试数据

const SUFFIX = Date.now().toString(36)

const JOB_TEXT = '岗位职责：\n1. 参与核心业务系统的后端开发，负责接口设计与实现；\n2. 配合前端完成联调。\n\n'
  + '任职要求：\n1. 熟悉 Java 基础与 Spring Boot 框架；\n2. 熟悉 MySQL 索引与常见优化手段；\n3. 了解 Redis 缓存的基本使用。'

const ANSWER_1 = 'Spring 的依赖注入是指由容器负责创建对象并注入其依赖，常见方式有构造器注入、Setter 注入与字段注入；'
  + '构造器注入能保证依赖不可变且非空，是官方推荐方式。'
const ANSWER_1_V2 = '依赖注入是控制反转的一种实现：对象不自己 new 依赖，而由 IoC 容器在创建时注入。'
  + '三种方式中构造器注入保证依赖不可变、便于测试，循环依赖也能在启动期暴露；Setter 注入适合可选依赖；字段注入不推荐。'

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  const registered = await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  if (login.body?.code !== 0) {
    console.error(`❌ 测试账号 ${username} 登录失败：${login.body?.message}`)
    process.exit(1)
  }
  // 登录响应不含 id（只有 token），取注册响应里的
  return { username, token: login.body.data.token, id: registered.body?.data?.id }
}

async function createJob(token, name) {
  const res = await api('POST', '/jobs', {
    token,
    body: { companyName: '验收科技', jobName: name, description: JOB_TEXT },
  })
  if (res.body?.code !== 0) {
    console.error(`❌ 建岗位失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data.id
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  console.log(`接口层验收（后端 ${BASE}）\n`)

  const a = await registerAndLogin('m7a')
  const b = await registerAndLogin('m7b')
  const jobId = await createJob(a.token, 'Java 后端开发实习生（验收）')
  console.log(`账号 A=${a.username} / B=${b.username}；岗位 #${jobId}\n`)

  // ============================================================== A 组 主链路

  console.log('A 组 主链路')

  const created = await api('POST', '/interviews', {
    token: a.token,
    body: { jobId, title: 'Java 后端开发实习生模拟面试', questionType: 'SPRING', questionCount: 1 },
  })
  const session = created.body?.data
  check('A1 创建会话 200，generatedCount 与 sortOrder 正确',
    created.body?.code === 0 && session?.generatedCount === 1 && session?.status === 0
      && session?.questions?.[0]?.sortOrder === 1 && session?.questions?.[0]?.question?.length > 0
      && session?.questionCount === 1,
    JSON.stringify({ code: created.body?.code, generatedCount: session?.generatedCount }))
  const sessionId = session?.id
  const questionId = session?.questions?.[0]?.id

  const evaluated = await api('POST', `/interviews/${sessionId}/questions/${questionId}/answer`, {
    token: a.token,
    body: { answer: ANSWER_1 },
  })
  const evaluation = evaluated.body?.data
  check('A2 提交回答 200，评价四字段齐备且分数在 0–100',
    evaluated.body?.code === 0 && evaluation?.score >= 0 && evaluation?.score <= 100
      && !!evaluation?.analysis && !!evaluation?.referenceAnswer && Array.isArray(evaluation?.suggestions),
    `score=${evaluation?.score}`)

  const detail = await api('GET', `/interviews/${sessionId}`, { token: a.token })
  const detailQuestion = detail.body?.data?.questions?.[0]
  check('A3 详情回读：回答与评价一致（含 suggestions JSON 列的真库回读）',
    detailQuestion?.answer === ANSWER_1 && detailQuestion?.score === evaluation?.score
      && detailQuestion?.analysis === evaluation?.analysis
      && Array.isArray(detailQuestion?.suggestions)
      && detailQuestion?.suggestions?.length === evaluation?.suggestions?.length,
    `answer 前缀=${String(detailQuestion?.answer).slice(0, 10)}`)

  check('A4 全部作答后会话已完成（status=1、totalScore=该题得分）',
    detail.body?.data?.status === 1 && Number(detail.body?.data?.totalScore) === Number(evaluation?.score),
    `status=${detail.body?.data?.status} totalScore=${detail.body?.data?.totalScore}`)

  const report1 = (await api('GET', `/interviews/${sessionId}/report`, { token: a.token })).body?.data
  check('A5 报告 completed=true，总分 = 题均分',
    report1?.completed === true && Number(report1?.totalScore) === Number(evaluation?.score),
    `totalScore=${report1?.totalScore}`)
  check('A6 报告头部字段齐备（jobId/jobName/companyName/questionType/completedAt）',
    report1?.jobId === jobId && report1?.jobName?.includes('Java 后端开发实习生')
      && report1?.companyName === '验收科技' && report1?.questionType === 'SPRING'
      && !!report1?.completedAt,
    JSON.stringify({ jobName: report1?.jobName, type: report1?.questionType }))

  const strengths = report1?.strengths
  const recommendations = report1?.recommendations
  check('A7 总评四字段非空（overallSummary / strengths / weaknesses / recommendations）',
    typeof report1?.overallSummary === 'string' && report1.overallSummary.length > 0
      && Array.isArray(strengths) && strengths.length > 0
      && Array.isArray(report1?.weaknesses) && report1.weaknesses.length > 0
      && Array.isArray(recommendations) && recommendations.length > 0,
    `summary 长度=${report1?.overallSummary?.length ?? 0}`)
  check('A8 逐题明细含分类与查看回答字段，categoryScores 仅统计已作答',
    Array.isArray(report1?.questions) && report1.questions.length === 1
      && report1.questions[0].answered === true
      && report1.questions[0].answer === ANSWER_1
      && Array.isArray(report1?.categoryScores) && report1.categoryScores.length >= 1
      && report1.categoryScores.every((item) => item.questionCount >= 1),
    JSON.stringify(report1?.categoryScores))

  // 重答：新分数生效、总分即时重算、completed_at 保持
  const reEvaluated = await api('POST', `/interviews/${sessionId}/questions/${questionId}/answer`, {
    token: a.token,
    body: { answer: ANSWER_1_V2 },
  })
  const newScore = Number(reEvaluated.body?.data?.score)
  const report2 = (await api('GET', `/interviews/${sessionId}/report`, { token: a.token })).body?.data
  check('A9 重答覆盖：总分即时重算为新得分（会话保持已完成）',
    reEvaluated.body?.code === 0 && Number(report2?.totalScore) === newScore
      && report2?.completed === true && report2?.status === 1,
    `重答 ${newScore} / 报告 ${report2?.totalScore}`)
  check('A10 重答不刷新 completedAt（保持首次完成时间）',
    report2?.completedAt === report1?.completedAt,
    `${report1?.completedAt} → ${report2?.completedAt}`)

  const detailAfter = (await api('GET', `/interviews/${sessionId}`, { token: a.token })).body?.data
  check('A11 覆盖提交不新增题目行（generatedCount 不变，answer 为新值）',
    detailAfter?.generatedCount === 1 && detailAfter?.answeredCount === 1
      && detailAfter?.questions?.[0]?.answer === ANSWER_1_V2,
    `generatedCount=${detailAfter?.generatedCount}`)

  // 部分完成会话（2 题只答 1 题）
  const partial = (await api('POST', '/interviews', {
    token: a.token,
    body: { jobId, title: '部分完成验收', questionType: 'JAVA', questionCount: 2 },
  })).body?.data
  await api('POST', `/interviews/${partial.id}/questions/${partial.questions[0].id}/answer`, {
    token: a.token,
    body: { answer: ANSWER_1 },
  })
  const partialReport = (await api('GET', `/interviews/${partial.id}/report`, { token: a.token })).body?.data
  check('A12 未完成报告：completed=false、totalScore/总评均为 null、分类只含已答组',
    partialReport?.completed === false && partialReport?.totalScore === null
      && partialReport?.overallSummary === null && partialReport?.answeredCount === 1
      && partialReport?.categoryScores?.every((item) => item.questionCount === 1),
    JSON.stringify({ completed: partialReport?.completed, totalScore: partialReport?.totalScore }))

  // 列表：倒序 + 内联名称 + 进度计数
  const list = (await api('GET', '/interviews?page=1&size=10', { token: a.token })).body?.data
  check('A13 列表倒序分页，内联岗位名称与进度计数',
    list?.total === 2 && list.records[0].id === partial.id
      && list.records[0].generatedCount === 2 && list.records[0].answeredCount === 1
      && list.records.every((item) => item.jobName && item.companyName === '验收科技'),
    JSON.stringify(list?.records?.map((r) => ({ id: r.id, g: r.generatedCount, a: r.answeredCount }))))

  // 删除岗位后：名称仍显示、报告仍可打开（关联查询不过滤 status）
  await api('DELETE', `/jobs/${jobId}`, { token: a.token })
  const listAfterDelete = (await api('GET', '/interviews?page=1&size=10', { token: a.token })).body?.data
  const reportAfterDelete = await api('GET', `/interviews/${sessionId}/report`, { token: a.token })
  check('A14 岗位逻辑删除后：列表名称仍显示、报告仍可打开',
    listAfterDelete?.records?.every((item) => item.jobName) && reportAfterDelete.body?.code === 0
      && reportAfterDelete.body?.data?.jobName?.includes('Java 后端开发实习生'),
    `list 首项 jobName=${listAfterDelete?.records?.[0]?.jobName}`)

  // ============================================================== B 组 边界

  console.log('\nB 组 边界与校验')

  const badCreate = async (body, label) => {
    const res = await api('POST', '/interviews', { token: a.token, body })
    check(label, res.status === 400 && res.body?.code === 40001, `http=${res.status} code=${res.body?.code}`)
  }
  const base = { jobId, title: 't', questionType: 'JAVA', questionCount: 1 }
  await badCreate({ ...base, questionType: 'JAVA2' }, 'B1 questionType 非法 → 40001')
  await badCreate({ ...base, questionCount: 0 }, 'B2 questionCount=0 → 40001')
  await badCreate({ ...base, questionCount: 21 }, 'B3 questionCount=21 → 40001')
  await badCreate({ ...base, title: '' }, 'B4 title 空白 → 40001')
  await badCreate({ ...base, title: 'x'.repeat(101) }, 'B5 title 101 字符 → 40001')
  await badCreate({ title: 't', questionType: 'JAVA', questionCount: 1 }, 'B6 jobId 缺失 → 40001')

  const badAnswer = async (body, label) => {
    const res = await api('POST', `/interviews/${sessionId}/questions/${questionId}/answer`,
      { token: a.token, body })
    check(label, res.status === 400 && res.body?.code === 40001, `http=${res.status} code=${res.body?.code}`)
  }
  await badAnswer({ answer: '' }, 'B7 answer 空串 → 40001')
  await badAnswer({ answer: '   ' }, 'B8 answer 纯空白 → 40001')
  await badAnswer({ answer: 'a'.repeat(5001) }, 'B9 answer 5001 字符 → 40001')

  const badPage = await api('GET', '/interviews?page=0&size=10', { token: a.token })
  const badSize = await api('GET', '/interviews?page=1&size=101', { token: a.token })
  check('B10 分页越界（page=0 / size=101）→ 40001',
    badPage.status === 400 && badPage.body?.code === 40001
      && badSize.status === 400 && badSize.body?.code === 40001,
    `page=${badPage.body?.code} size=${badSize.body?.code}`)

  const noToken = await api('GET', '/interviews?page=1&size=10')
  const badToken = await api('GET', '/interviews?page=1&size=10', { token: 'not-a-token' })
  check('B11 无 Token / 坏 Token → 401/40100',
    noToken.status === 401 && noToken.body?.code === 40100
      && badToken.status === 401 && badToken.body?.code === 40100,
    `${noToken.body?.code}/${badToken.body?.code}`)

  // ============================================================== C 组 越权

  console.log('\nC 组 越权矩阵')

  const c1 = await api('GET', `/interviews/${sessionId}`, { token: b.token })
  const c2 = await api('GET', `/interviews/${sessionId}/report`, { token: b.token })
  check('C1 他人会话的详情/报告 → 404/40400',
    c1.status === 404 && c1.body?.code === 40400 && c2.status === 404 && c2.body?.code === 40400,
    `${c1.body?.code}/${c2.body?.code}`)

  const c3 = await api('POST', `/interviews/${sessionId}/questions/${questionId}/answer`,
    { token: b.token, body: { answer: '越权尝试' } })
  check('C2 向他人题目提交回答 → 404（且不触达模型）', c3.status === 404 && c3.body?.code === 40400,
    `code=${c3.body?.code}`)

  const c4 = await api('POST', '/interviews', {
    token: b.token,
    body: { jobId, title: 't', questionType: 'JAVA', questionCount: 1 },
  })
  check('C3 用他人的岗位创建会话 → 404（且不触达模型）', c4.status === 404 && c4.body?.code === 40400,
    `code=${c4.body?.code}`)

  const c5 = await api('POST', `/interviews/${partial.id}/questions/${questionId}/answer`,
    { token: a.token, body: { answer: '跨会话拼接' } })
  check('C4 跨会话拼接题目（会话 B + 属于会话 A 的题目）→ 404', c5.status === 404 && c5.body?.code === 40400,
    `code=${c5.body?.code}`)

  const bList = (await api('GET', '/interviews?page=1&size=10', { token: b.token })).body?.data
  check('C5 列表只返回本人数据（B 的列表为空）', bList?.total === 0, `total=${bList?.total}`)

  // ---------------------------------------------------------------- 汇总

  console.log(`\n${'—'.repeat(60)}`)
  console.log(`共 ${passed + failures.length} 项断言，通过 ${passed}，失败 ${failures.length}`)
  if (failures.length > 0) {
    console.log('\n失败项：')
    for (const item of failures) {
      console.log(`  - ${item}`)
    }
  }
  console.log('\n清理数据（外键顺序；后端无删除用户接口）：')
  console.log(`  DELETE q FROM interview_question q JOIN interview_session s ON s.id = q.session_id WHERE s.user_id IN (${a.id}, ${b.id});`)
  console.log(`  DELETE FROM interview_session WHERE user_id IN (${a.id}, ${b.id});`)
  console.log(`  DELETE FROM job WHERE user_id IN (${a.id}, ${b.id});`)
  console.log(`  DELETE FROM sys_user WHERE id IN (${a.id}, ${b.id});`)

  return failures.length
}

const failedCount = await main()
await sleep(50)
process.exit(failedCount > 0 ? 1 : 0)
