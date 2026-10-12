/**
 * M9 仪表盘接口层验收（《API接口设计》§9.1、FR-DASH-01）。
 *
 * 覆盖五组：
 * A 空数据边界（计数全 0 / bestMatchScore=null / 两个空数组 / 未认证 401）
 * B 计数交叉核对（简历与岗位的计数与各模块列表**逐条一致**，含 stale 口径）
 * C 匹配与差距（bestMatchScore / recentMatches 固定 8 字段 / topGaps 顺序与截断与报告逐条一致）
 * D 面试计数（完成 1 场 + 进行中 1 场 → 总数 / 进行中 / 已完成）
 * E 边界与可见性（删除资源后计数回落、recentMatches 名称仍显示、账号间隔离）
 *
 * 前置：后端已在 8080 运行（最新代码）、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**约 10 次真实模型调用**（简历分析 2 + 岗位分析 2 + 匹配解释 2 + 面试出题 2 + 评价 1 + 总评 1）。
 *
 * 运行：node tools/verify/m9-dashboard-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

const PASSWORD = 'verify1234'

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  [OK] ${name}`)
  }
  else {
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

async function registerAndLogin(prefix) {
  const username = `${prefix}_${Date.now().toString(36)}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  if (login.body?.code !== 0) {
    console.error(`❌ 测试账号 ${username} 登录失败：${login.body?.message}`)
    process.exit(1)
  }
  return { username, token: login.body.data.token, id: login.body.data.user?.id }
}

async function uploadResume(token, name, content) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', new Blob([content], { type: 'text/plain' }), `${name}.txt`)
  const res = await fetch(`${BASE}/resumes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const json = await res.json().catch(() => null)
  if (json?.code !== 0) {
    console.error(`❌ 上传简历失败：${json?.message}`)
    process.exit(1)
  }
  return json.data.id
}

async function analyzeResume(token, id) {
  const res = await api('POST', `/resumes/${id}/analyze`, { token })
  if (res.body?.code !== 0) {
    console.error(`❌ 简历分析失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data
}

async function createJob(token, jobName, description) {
  const res = await api('POST', '/jobs', {
    token,
    body: { companyName: '验收科技', jobName, description },
  })
  if (res.body?.code !== 0) {
    console.error(`❌ 建岗位失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data.id
}

async function analyzeJob(token, id) {
  const res = await api('POST', `/jobs/${id}/analyze`, { token })
  if (res.body?.code !== 0) {
    console.error(`❌ 岗位分析失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data
}

async function updateJob(token, id, jobName, description) {
  const res = await api('PUT', `/jobs/${id}`, {
    token,
    body: { jobName, description },
  })
  if (res.body?.code !== 0) {
    console.error(`❌ 更新岗位失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data
}

async function createMatch(token, resumeId, jobId) {
  const res = await api('POST', '/matches', { token, body: { resumeId, jobId } })
  if (res.body?.code !== 0) {
    console.error(`❌ 创建匹配失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data
}

async function createInterview(token, jobId, title, questionCount) {
  const res = await api('POST', '/interviews', {
    token,
    body: { jobId, title, questionType: 'JAVA', questionCount },
  })
  if (res.body?.code !== 0) {
    console.error(`❌ 创建面试失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data
}

async function answerQuestion(token, sessionId, questionId, answer) {
  const res = await api('POST', `/interviews/${sessionId}/questions/${questionId}/answer`, {
    token,
    body: { answer },
  })
  if (res.body?.code !== 0) {
    console.error(`❌ 提交回答失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data
}

async function dashboard(token) {
  const res = await api('GET', '/dashboard/summary', { token })
  return res
}

const RESUME_A = '姓名：张三。本科，计算机科学与技术专业。\n'
  + '技能：Java（熟练）、Spring Boot（熟练）、MySQL（熟悉）、Redis（了解）。\n'
  + '项目经历：校园二手交易平台后端开发，负责订单与支付模块，使用 Spring Boot + MySQL 实现。\n'

const RESUME_B = '姓名：李四。本科，软件工程专业。\n'
  + '技能：Java、Spring Boot、MySQL。\n'
  + '项目：电商后台管理系统开发，负责用户与商品模块。\n'

const JOB_A = '岗位职责：\n1. 参与核心业务系统的后端开发，负责接口设计与实现；\n2. 配合前端完成联调。\n\n'
  + '任职要求：\n1. 熟悉 Java 基础与 Spring Boot 框架；\n2. 熟悉 MySQL 索引与常见优化手段；\n'
  + '3. 了解 Redis 缓存的基本使用；\n4. 有 Docker 部署经验者优先。'

const JOB_C = '岗位职责：负责小程序前端页面开发与维护。\n\n任职要求：熟悉 Vue 与小程序开发，了解组件化。'

const JOB_STALE_NEW = '岗位职责：负责数据平台建设的全栈开发（描述已更新，原分析因此过期）。\n\n'
  + '任职要求：熟悉 Java、Python 与大数据相关技术栈。'

const ANSWER_1 = '我会用 Spring Boot 的 @Transactional 注解控制事务，'
  + '并注意事务边界不要包住远程调用；MySQL 索引方面会遵循最左前缀原则，用 explain 分析慢查询。'

async function main() {
  console.log(`M9 仪表盘接口层验收（后端 ${BASE}）\n`)

  const a = await registerAndLogin('m9a')
  const b = await registerAndLogin('m9b')
  console.log(`账号 A=${a.username} / B=${b.username}\n`)

  // ============================================================== A 组 空数据边界（零模型）

  console.log('A 组 空数据边界（零模型调用）')

  const empty = await dashboard(b.token)
  check('A1 汇总接口 200 且响应成功', empty.status === 200 && empty.body?.code === 0,
    `http=${empty.status} code=${empty.body?.code}`)
  const e = empty.body?.data
  check('A2 全部计数为 0',
    e?.resumeCount === 0 && e?.resumeAnalyzedCount === 0 && e?.jobCount === 0
    && e?.jobAnalyzedCount === 0 && e?.jobStaleCount === 0 && e?.matchCount === 0
    && e?.interviewCount === 0 && e?.interviewOngoingCount === 0 && e?.interviewCompletedCount === 0,
    JSON.stringify(e))
  check('A3 bestMatchScore 无记录时为 null（不是 0）', e?.bestMatchScore === null,
    `bestMatchScore=${JSON.stringify(e?.bestMatchScore)}`)
  check('A4 无记录时 recentMatches 为空数组', Array.isArray(e?.recentMatches) && e.recentMatches.length === 0,
    JSON.stringify(e?.recentMatches))
  check('A5 无记录时 topGaps 为空数组', Array.isArray(e?.topGaps) && e.topGaps.length === 0,
    JSON.stringify(e?.topGaps))

  const noToken = await dashboard(null)
  check('A6 无 Token → 401 / 40100', noToken.status === 401 && noToken.body?.code === 40100,
    `http=${noToken.status} code=${noToken.body?.code}`)

  // ============================================================== 准备数据（B 组前置）

  console.log('\n准备数据：2 简历（1 分析）+ 3 岗位（2 分析、1 制造过期）')

  const resumeA = await uploadResume(a.token, '仪表盘简历A', RESUME_A)
  const resumeB = await uploadResume(a.token, '仪表盘简历B', RESUME_B)
  await analyzeResume(a.token, resumeA)

  const jobA = await createJob(a.token, 'Java后端开发实习生', JOB_A)
  await analyzeJob(a.token, jobA)
  const jobStale = await createJob(a.token, '全栈开发工程师', JOB_C)
  await analyzeJob(a.token, jobStale)
  await updateJob(a.token, jobStale, '全栈开发工程师', JOB_STALE_NEW)
  const jobC = await createJob(a.token, '小程序前端开发', JOB_C)

  // ============================================================== B 组 计数交叉核对

  console.log('\nB 组 计数与各模块列表交叉核对')

  const summary1 = (await dashboard(a.token)).body?.data
  const resumeList = (await api('GET', '/resumes?page=1&size=100', { token: a.token })).body?.data
  const jobList = (await api('GET', '/jobs?page=1&size=100', { token: a.token })).body?.data

  check('B1 resumeCount == /resumes 列表 total（只计有效简历）',
    summary1?.resumeCount === resumeList?.total, `${summary1?.resumeCount} vs ${resumeList?.total}`)
  check('B2 resumeAnalyzedCount == 列表 analyzed 的汇总（去重、含成功分析）',
    summary1?.resumeAnalyzedCount === resumeList?.records.filter((r) => r.analyzed).length,
    `${summary1?.resumeAnalyzedCount} vs ${resumeList?.records.filter((r) => r.analyzed).length}`)
  check('B3 jobCount == /jobs 列表 total', summary1?.jobCount === jobList?.total,
    `${summary1?.jobCount} vs ${jobList?.total}`)
  check('B4 jobAnalyzedCount == 列表 analyzed 的汇总',
    summary1?.jobAnalyzedCount === jobList?.records.filter((r) => r.analyzed).length,
    `${summary1?.jobAnalyzedCount} vs ${jobList?.records.filter((r) => r.analyzed).length}`)
  check('B5 jobStaleCount == 列表 stale 的汇总（且 stale ⊆ analyzed）',
    summary1?.jobStaleCount === jobList?.records.filter((r) => r.stale).length
    && summary1.jobStaleCount <= summary1.jobAnalyzedCount,
    `${summary1?.jobStaleCount} vs ${jobList?.records.filter((r) => r.stale).length}`)

  // ============================================================== C 组 匹配与差距

  console.log('\nC 组 匹配与差距（bestMatchScore / recentMatches / topGaps）')

  const match1 = await createMatch(a.token, resumeA, jobA)
  const summary2 = (await dashboard(a.token)).body?.data

  check('C1 matchCount = 1', summary2?.matchCount === 1, `${summary2?.matchCount}`)
  check('C2 bestMatchScore == 报告 matchScore', summary2?.bestMatchScore === match1.matchScore,
    `${summary2?.bestMatchScore} vs ${match1.matchScore}`)

  const recentFirst = summary2?.recentMatches?.[0]
  const expectedKeys = ['companyName', 'createdAt', 'id', 'jobId', 'jobName', 'matchScore', 'resumeId', 'resumeName']
  check('C3 recentMatches[0] 为固定 8 字段（无 resumeVersionNo / jobVersionNo）',
    recentFirst && JSON.stringify(Object.keys(recentFirst).sort()) === JSON.stringify(expectedKeys),
    JSON.stringify(Object.keys(recentFirst ?? {}).sort()))
  check('C4 recentMatches[0] 与匹配报告一致（id / 分数 / 名称 / 时间）',
    recentFirst?.id === match1.id && recentFirst?.matchScore === match1.matchScore
    && recentFirst?.resumeName === match1.resumeName && recentFirst?.jobName === match1.jobName
    && recentFirst?.companyName === match1.companyName
    && new Date(recentFirst?.createdAt).getTime() === new Date(match1.createdAt).getTime(),
    JSON.stringify(recentFirst))
  check('C5 recentMatches[0].createdAt 为 ISO-8601 本地时间（可被日期库解析）',
    !Number.isNaN(new Date(recentFirst?.createdAt).getTime()), `${recentFirst?.createdAt}`)

  // topGaps 与报告逐条一致：missing 在前（MISSING）、partial 在后（PARTIAL）、最多 3 条
  const expectedGaps = [
    ...(match1.missingItems ?? []).map((item) => ({ type: 'MISSING', text: item.text, dimension: item.dimension ?? null })),
    ...(match1.partialItems ?? []).map((item) => ({ type: 'PARTIAL', text: item.text, dimension: item.dimension ?? null })),
  ].slice(0, 3)
  const actualGaps = (summary2?.topGaps ?? []).map((item) => ({
    type: item.type, text: item.text, dimension: item.dimension ?? null,
  }))
  check('C6 topGaps 与报告 missing+partial 截 3 逐条一致（MISSING 在前）',
    JSON.stringify(actualGaps) === JSON.stringify(expectedGaps),
    `实际 ${JSON.stringify(actualGaps)} / 期望 ${JSON.stringify(expectedGaps)}`)
  const firstPartial = actualGaps.findIndex((item) => item.type === 'PARTIAL')
  check('C7 topGaps 顺序：所有 MISSING 在 PARTIAL 之前（且 type 仅两种取值）',
    actualGaps.every((item) => item.type === 'MISSING' || item.type === 'PARTIAL')
    && (firstPartial === -1 || actualGaps.slice(firstPartial).every((item) => item.type === 'PARTIAL')),
    JSON.stringify(actualGaps.map((item) => item.type)))

  // 第二次匹配：换一份简历（先补分析——匹配要求双方都有分析；
  // 两份简历的技能不同 → 规则分数不同，使 bestMatchScore 取最高的验证更有力）
  await analyzeResume(a.token, resumeB)
  const match2 = await createMatch(a.token, resumeB, jobA)
  const summary3 = (await dashboard(a.token)).body?.data
  check('C8 第二次匹配后 matchCount = 2、recentMatches[0] 为最新一条',
    summary3?.matchCount === 2 && summary3?.recentMatches?.[0]?.id === match2.id,
    `matchCount=${summary3?.matchCount} first=${summary3?.recentMatches?.[0]?.id} new=${match2.id}`)
  check('C9 bestMatchScore == max(两次匹配分数)',
    summary3?.bestMatchScore === Math.max(match1.matchScore, match2.matchScore),
    `${summary3?.bestMatchScore} vs ${Math.max(match1.matchScore, match2.matchScore)}`)
  check('C10 recentMatches 仍不超过 5 条', (summary3?.recentMatches?.length ?? 0) <= 5)

  // ============================================================== D 组 面试计数

  console.log('\nD 组 面试计数（完成 1 场 + 进行中 1 场）')

  const session1 = await createInterview(a.token, jobA, '仪表盘验收·完成场', 1)
  await answerQuestion(a.token, session1.id, session1.questions[0].id, ANSWER_1)
  const summary4 = (await dashboard(a.token)).body?.data
  check('D1 完成 1 场：总数 1 / 进行中 0 / 已完成 1',
    summary4?.interviewCount === 1 && summary4?.interviewOngoingCount === 0
    && summary4?.interviewCompletedCount === 1,
    JSON.stringify({ total: summary4?.interviewCount, ongoing: summary4?.interviewOngoingCount, completed: summary4?.interviewCompletedCount }))

  await createInterview(a.token, jobA, '仪表盘验收·进行中场', 1)
  const summary5 = (await dashboard(a.token)).body?.data
  check('D2 再建 1 场未作答：总数 2 / 进行中 1 / 已完成 1',
    summary5?.interviewCount === 2 && summary5?.interviewOngoingCount === 1
    && summary5?.interviewCompletedCount === 1,
    JSON.stringify({ total: summary5?.interviewCount, ongoing: summary5?.interviewOngoingCount, completed: summary5?.interviewCompletedCount }))

  // ============================================================== E 组 边界与可见性

  console.log('\nE 组 边界与可见性（删除回落 / 名称仍显示 / 账号隔离）')

  // 删除参与匹配的简历 A：resumeCount 回落、resumeAnalyzedCount 同步回落
  await api('DELETE', `/resumes/${resumeA}`, { token: a.token })
  const summary6 = (await dashboard(a.token)).body?.data
  check('E1 删除已分析简历后：resumeCount 与 resumeAnalyzedCount 均回落（B 的分析保留）',
    summary6?.resumeCount === 1 && summary6?.resumeAnalyzedCount === 1,
    JSON.stringify({ count: summary6?.resumeCount, analyzed: summary6?.resumeAnalyzedCount }))
  check('E2 删除简历后 recentMatches 的名称仍显示（关联查询不过滤 status）',
    summary6?.recentMatches?.every((item) => typeof item.resumeName === 'string' && item.resumeName.length > 0)
    && summary6?.recentMatches?.some((item) => item.resumeId === resumeA),
    JSON.stringify(summary6?.recentMatches?.map((item) => item.resumeName)))

  // 删除参与匹配的岗位 A：jobCount / jobAnalyzedCount 回落，stale 岗位计数不变
  await api('DELETE', `/jobs/${jobA}`, { token: a.token })
  const summary7 = (await dashboard(a.token)).body?.data
  check('E3 删除已分析岗位后：jobCount 回落、jobStaleCount 不变（过期的是另一岗位）',
    summary7?.jobCount === 2 && summary7?.jobAnalyzedCount === 1 && summary7?.jobStaleCount === 1,
    JSON.stringify({ job: summary7?.jobCount, analyzed: summary7?.jobAnalyzedCount, stale: summary7?.jobStaleCount }))
  check('E4 删除岗位后 recentMatches 的名称仍显示',
    summary7?.recentMatches?.some((item) => item.jobId === jobA && typeof item.jobName === 'string' && item.jobName.length > 0),
    JSON.stringify(summary7?.recentMatches?.map((item) => item.jobName)))

  // 账号隔离：A 有数据时 B 仍全 0
  const bSummary = (await dashboard(b.token)).body?.data
  check('E5 账号间隔离：A 有数据时 B 的汇总仍全 0',
    bSummary?.resumeCount === 0 && bSummary?.matchCount === 0 && bSummary?.interviewCount === 0,
    JSON.stringify(bSummary))

  // ============================================================== 清理提示

  const uids = `${a.id ?? '<uid-a>'}, ${b.id ?? '<uid-b>'}`
  console.log('\n测试数据清理（后端无删除用户接口，需手工执行；表间有外键约束，须按依赖自底向上）：')
  console.log(`  DELETE FROM interview_question WHERE session_id IN (SELECT id FROM interview_session WHERE user_id IN (${uids}));`)
  console.log(`  DELETE FROM interview_session WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM match_record WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM job_analysis WHERE job_id IN (SELECT id FROM job WHERE user_id IN (${uids}));`)
  console.log(`  DELETE FROM job WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id IN (${uids}));`)
  console.log(`  DELETE FROM resume WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM sys_user WHERE id IN (${uids});`)
  console.log(`  -- 物理文件目录：~/career-pilot-uploads/ 下该账号的子目录（${uids}）`)

  console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`)
  if (failures.length > 0) {
    console.log('\n失败明细：')
    failures.forEach((item) => console.log(`  - ${item}`))
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('❌ 脚本异常：', error)
  process.exit(1)
})
