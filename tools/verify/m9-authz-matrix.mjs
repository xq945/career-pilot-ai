/**
 * M9 安全专项 · 越权矩阵（《测试与验收方案》§2.2 编号 1–10）。
 *
 * 预备：账号 A、B 各一套数据；**全部断言用 A 的 Token 访问 B 的资源**，
 * 预期一律 404 / 40400（不区分"不存在"与"无权访问"，不暴露资源存在性）。
 *
 * 与各处 e2e 用例的分工：本脚本把矩阵逐行集中执行一遍，作为**安全专项的系统性记录**；
 * 矩阵第 10 行（登录 40100 不触发前端全局登出）是前端回归项，证据见
 * `tools/e2e/auth-flow.mjs`（《验证记录》§2 的第 11 项）与 `tools/e2e/README.md` 的坑清单，
 * 不在本脚本内重复；第 11 行（资料/头像接口无资源 ID 参数）无需测试。
 *
 * 前置：后端已在 8080 运行、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**约 6 次真实模型调用**——B 侧造数据（简历分析 1 + 岗位分析 1 + 匹配 1 +
 *      出题 1 + 对话 1）与 A 侧工具越权对话 1；越权请求本身全部在模型调用之前被拦下（零成本）。
 *
 * 运行：node tools/verify/m9-authz-matrix.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

const PASSWORD = 'verify1234'

/** 单次对话的等待上限（后端契约 120 秒 + 在途调用余量） */
const CHAT_TIMEOUT = 200000

/** B 简历的独有标记：用于断言 A 的对话回复中不泄露 B 的数据（矩阵第 9 行） */
const B_MARKER = 'B用户独有标记ZZ9'

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

async function chat(token, message, extra = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT)
  try {
    const res = await fetch(`${BASE}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, ...extra }),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, body: json }
  }
  finally {
    clearTimeout(timer)
  }
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

async function createJob(token, jobName, description) {
  const res = await api('POST', '/jobs', {
    token,
    body: { companyName: '越权验收科技', jobName, description },
  })
  if (res.body?.code !== 0) {
    console.error(`❌ 建岗位失败：${res.body?.message}`)
    process.exit(1)
  }
  return res.body.data.id
}

// 注意：文本须超过"过短"阈值（50 字符），否则上传会被 400 拒绝（M3《验证记录》遗留 2）
const RESUME_TEXT_A = '姓名：甲。本科，计算机科学与技术专业，2026 届应届生。\n'
  + '技能：Java、Spring Boot、MySQL、Git。\n'
  + '项目经历：校园二手交易平台后端开发，负责用户模块与订单模块的接口设计与实现。\n'

const RESUME_TEXT_B = '姓名：乙。本科，软件工程专业，2026 届应届生。\n'
  + `技能：Java、Redis、MySQL。${B_MARKER}：本科毕业设计为校园订餐系统。\n`
  + '项目经历：订餐系统后端开发，负责支付与库存模块，使用 Spring Boot + MySQL 实现。\n'

const JOB_TEXT = '岗位职责：参与后端开发。\n\n任职要求：熟悉 Java 与 Spring Boot；了解 MySQL。'

async function main() {
  console.log(`M9 越权矩阵验收（《测试与验收方案》§2.2 编号 1–10，后端 ${BASE}）\n`)

  const a = await registerAndLogin('m9xa')
  const b = await registerAndLogin('m9xb')
  console.log(`账号 A=${a.username} / B=${b.username}\n`)

  // ------------------------------------------------------------ 预备数据

  console.log('预备：A 侧简历与岗位（零模型）；B 侧全套数据（矩阵要有真实存在的 B 资源）')

  const aResume = await uploadResume(a.token, 'A的简历', RESUME_TEXT_A)
  const aJob = await createJob(a.token, 'A的岗位', JOB_TEXT)

  const bResume = await uploadResume(b.token, 'B的简历', RESUME_TEXT_B)
  const bJob = await createJob(b.token, 'B的岗位', JOB_TEXT)
  await api('POST', `/resumes/${bResume}/analyze`, { token: b.token })
  await api('POST', `/jobs/${bJob}/analyze`, { token: b.token })
  const bMatch = (await api('POST', '/matches', { token: b.token, body: { resumeId: bResume, jobId: bJob } })).body?.data
  const bInterview = (await api('POST', '/interviews', {
    token: b.token,
    body: { jobId: bJob, title: 'B的面试', questionType: 'JAVA', questionCount: 1 },
  })).body?.data
  const bChat = await chat(b.token, '你好')
  const bAgentSessionId = bChat.body?.data?.sessionId

  console.log(`B 侧资源就绪：resume=${bResume} job=${bJob} match=${bMatch?.id} interview=${bInterview?.id} agentSession=${bAgentSessionId}\n`)

  // ============================================================== 第 1 行：简历

  console.log('第 1 行：A 的 Token + B 的简历（详情/删除/分析/查分析/预览/下载）')
  const r1 = await api('GET', `/resumes/${bResume}`, { token: a.token })
  check('1a 详情 → 404 / 40400', r1.status === 404 && r1.body?.code === 40400, `http=${r1.status} code=${r1.body?.code}`)
  const r2 = await api('DELETE', `/resumes/${bResume}`, { token: a.token })
  check('1b 删除 → 404', r2.status === 404, `http=${r2.status}`)
  const r3 = await api('POST', `/resumes/${bResume}/analyze`, { token: a.token })
  check('1c 发起分析 → 404', r3.status === 404, `http=${r3.status}`)
  const r4 = await api('GET', `/resumes/${bResume}/analysis`, { token: a.token })
  check('1d 查看分析 → 404', r4.status === 404, `http=${r4.status}`)
  const r5 = await api('GET', `/resumes/${bResume}/file`, { token: a.token })
  check('1e 预览原文 → 404', r5.status === 404, `http=${r5.status}`)
  const r6 = await api('GET', `/resumes/${bResume}/file?download=true`, { token: a.token })
  check('1f 下载原文 → 404', r6.status === 404, `http=${r6.status}`)

  // ============================================================== 第 2 行：岗位

  console.log('\n第 2 行：A 的 Token + B 的岗位（详情/更新/删除/分析/查分析）')
  const j1 = await api('GET', `/jobs/${bJob}`, { token: a.token })
  check('2a 详情 → 404', j1.status === 404, `http=${j1.status}`)
  const j2 = await api('PUT', `/jobs/${bJob}`, { token: a.token, body: { jobName: '篡改', description: JOB_TEXT } })
  check('2b 更新 → 404', j2.status === 404, `http=${j2.status}`)
  const j3 = await api('DELETE', `/jobs/${bJob}`, { token: a.token })
  check('2c 删除 → 404', j3.status === 404, `http=${j3.status}`)
  const j4 = await api('POST', `/jobs/${bJob}/analyze`, { token: a.token })
  check('2d 发起分析 → 404', j4.status === 404, `http=${j4.status}`)
  const j5 = await api('GET', `/jobs/${bJob}/analysis`, { token: a.token })
  check('2e 查看分析 → 404', j5.status === 404, `http=${j5.status}`)

  // ============================================================== 第 3 行：匹配记录

  console.log('\n第 3 行：A 的 Token + B 的匹配记录')
  const m1 = await api('GET', `/matches/${bMatch?.id}`, { token: a.token })
  check('3 匹配报告 → 404', m1.status === 404, `http=${m1.status}`)

  // ============================================================== 第 4 行：面试会话 / 题目

  console.log('\n第 4 行：A 的 Token + B 的面试会话 / 题目')
  const i1 = await api('GET', `/interviews/${bInterview?.id}`, { token: a.token })
  check('4a 会话详情 → 404', i1.status === 404, `http=${i1.status}`)
  const i2 = await api('GET', `/interviews/${bInterview?.id}/report`, { token: a.token })
  check('4b 面试报告 → 404', i2.status === 404, `http=${i2.status}`)
  const bQuestionId = bInterview?.questions?.[0]?.id
  const i3 = await api('POST', `/interviews/${bInterview?.id}/questions/${bQuestionId}/answer`, {
    token: a.token,
    body: { answer: '越权提交的回答内容' },
  })
  check('4c 提交回答 → 404（不触达模型）', i3.status === 404, `http=${i3.status}`)

  // ============================================================== 第 5 行：Agent 会话

  console.log('\n第 5 行：A 的 Token + B 的 Agent 会话')
  const g1 = await api('GET', `/agent/sessions/${bAgentSessionId}`, { token: a.token })
  check('5a 消息回看 → 404', g1.status === 404, `http=${g1.status}`)
  const g2 = await chat(a.token, '继续', { sessionId: bAgentSessionId })
  check('5b 续聊 → 404（不触达模型）', g2.status === 404, `http=${g2.status}`)

  // ============================================================== 第 6 行：请求体夹带 B 的资源

  console.log('\n第 6 行：请求体夹带 B 的资源 ID')
  const c1 = await api('POST', '/matches', { token: a.token, body: { resumeId: bResume, jobId: aJob } })
  check('6a 创建匹配用 B 的简历 → 404', c1.status === 404, `http=${c1.status}`)
  const c2 = await api('POST', '/interviews', {
    token: a.token,
    body: { jobId: bJob, title: '夹带验收', questionType: 'JAVA', questionCount: 1 },
  })
  check('6b 创建面试用 B 的岗位 → 404', c2.status === 404, `http=${c2.status}`)
  const c3 = await chat(a.token, '你好', { resumeId: bResume })
  check('6c Agent 上下文带 B 的简历 → 404', c3.status === 404, `http=${c3.status}`)
  const c4 = await chat(a.token, '你好', { jobId: bJob })
  check('6d Agent 上下文带 B 的岗位 → 404', c4.status === 404, `http=${c4.status}`)

  // ============================================================== 第 7 行：鉴权

  console.log('\n第 7 行：无 Token / 无效 Token')
  const t1 = await api('GET', `/resumes/${aResume}`)
  check('7a 无 Token → 401 / 40100', t1.status === 401 && t1.body?.code === 40100, `http=${t1.status} code=${t1.body?.code}`)
  const t2 = await api('GET', `/resumes/${aResume}`, { token: 'invalid.token.value' })
  check('7b 无效 Token → 401 / 40100', t2.status === 401 && t2.body?.code === 40100, `http=${t2.status} code=${t2.body?.code}`)
  const t3 = await chat(null, '你好')
  check('7c Agent 无 Token → 401 / 40100', t3.status === 401 && t3.body?.code === 40100, `http=${t3.status}`)
  console.log('    （签名有效但已过期的 Token 由《验证记录》§2 的接口层 A 表第 7 项单独覆盖）')

  // ============================================================== 第 8 行：列表隔离

  console.log('\n第 8 行：全部列表接口只返回 A 自己的数据')
  const listResumes = (await api('GET', '/resumes?page=1&size=100', { token: a.token })).body?.data
  const listJobs = (await api('GET', '/jobs?page=1&size=100', { token: a.token })).body?.data
  const listMatches = (await api('GET', '/matches?page=1&size=100', { token: a.token })).body?.data
  const listInterviews = (await api('GET', '/interviews?page=1&size=100', { token: a.token })).body?.data
  const listSessions = (await api('GET', '/agent/sessions?page=1&size=100', { token: a.token })).body?.data
  check('8a 简历列表仅含 A 的 1 条（B 的 1 条不可见）',
    listResumes?.total === 1 && listResumes?.records?.every((r) => r.id === aResume),
    `total=${listResumes?.total}`)
  check('8b 岗位列表仅含 A 的 1 条', listJobs?.total === 1 && listJobs?.records?.every((r) => r.id === aJob),
    `total=${listJobs?.total}`)
  check('8c 匹配列表为空（A 无匹配，B 的 1 条不可见）', listMatches?.total === 0, `total=${listMatches?.total}`)
  check('8d 面试列表为空（A 无会话，B 的 1 条不可见）', listInterviews?.total === 0, `total=${listInterviews?.total}`)
  check('8e Agent 会话列表为空（B 的 1 条不可见）', listSessions?.total === 0, `total=${listSessions?.total}`)

  // ============================================================== 第 9 行：工具侧（AG-03）

  console.log('\n第 9 行：Agent 对话中指名 B 的简历 ID（工具侧越权）')
  const ag = await chat(a.token, `请直接帮我分析简历 ID 为 ${bResume} 的简历，并给出它的技能清单`)
  const agData = ag.body?.data
  const agAnswer = agData?.answer ?? ''
  // 若模型应允并调用了 analyzeResume，该调用必须被工具内的归属校验拒绝（失败信封），
  // 绝不能返回 SUCCESS——否则就是真的读到了 B 的数据
  const analyzeCalls = (agData?.toolCalls ?? []).filter((t) => t.toolName === 'analyzeResume')
  check('9a 对话未泄露 B 简历的独有内容（未出现独有标记）',
    ag.body?.code === 0 && !agAnswer.includes(B_MARKER),
    agAnswer.replace(/\s+/g, ' ').slice(0, 80))
  check('9b 对 B 的简历的工具调用一律被拒绝（无 SUCCESS 记录）',
    analyzeCalls.every((t) => t.status !== 'SUCCESS'),
    JSON.stringify(analyzeCalls))

  // ============================================================== 矩阵其余两行（说明）

  console.log('\n矩阵第 10、11 行（不在本脚本内执行）')
  console.log('  第 10 行「登录 40100 不触发全局登出」为前端回归项：证据见 tools/e2e/auth-flow.mjs（《验证记录》§2 第 11 项）')
  console.log('  第 11 行「资料/头像接口无资源 ID 参数、无越权面」：无需测试（《测试与验收方案》§2.2 原文）')

  // ============================================================== 清理提示

  const uids = `${a.id ?? '<uid-a>'}, ${b.id ?? '<uid-b>'}`
  console.log('\n测试数据清理（后端无删除用户接口，需手工执行；表间有外键约束，须按依赖自底向上）：')
  console.log(`  DELETE FROM agent_chat_message WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM agent_session WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM interview_question WHERE session_id IN (SELECT id FROM interview_session WHERE user_id IN (${uids}));`)
  console.log(`  DELETE FROM interview_session WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM match_record WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM job_analysis WHERE job_id IN (SELECT id FROM job WHERE user_id IN (${uids}));`)
  console.log(`  DELETE FROM job WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id IN (${uids}));`)
  console.log(`  DELETE FROM resume WHERE user_id IN (${uids});`)
  console.log(`  DELETE FROM sys_user WHERE id IN (${uids});`)
  console.log(`  -- 物理文件目录：~/career-pilot-uploads/ 下两个账号的子目录（${uids}）`)

  console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`)
  if (failures.length > 0) {
    console.log('\n失败明细：')
    failures.forEach((item) => console.log(`  - ${item}`))
    return 1
  }
  return 0
}

process.exit(await main().catch((error) => {
  console.error('❌ 脚本异常：', error)
  return 1
}))
