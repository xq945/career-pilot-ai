/**
 * M12 面试接入工作流接口层验收（《开发顺序》M12 的「curl 验收」环节；用 Node fetch 实现
 * 等价的用例组，可复现、可断言、可重跑）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M12 的新实例**）、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**7 次真实模型调用**（简历分析 1 + 岗位分析 1 + 创建优化 2〔匹配解释 + 优化生成〕
 *      + 出题 3〔优化来源 / 仅简历 / 无来源〕）。
 *
 * 覆盖验收标准（《开发顺序》M12、《一体化工作流收口方案》§4）：
 * - 优化来源：会话落 resumeId/optimizationId（resumeId 由服务端从优化推导），
 *   列表 / 详情 / 报告三处来源字段正确；
 * - 仅简历来源：创建成功，来源字段正确（出题携带简历文本与最近匹配差距——内容属人工核验）；
 * - 无来源：行为与历史一致，来源字段均为 null；
 * - 一致性校验：优化岗位与 jobId 不一致 → 400；显式 resumeId 与优化不一致 → 400；
 * - 越权：他人优化 / 简历 → 404（不泄露存在性）。
 *
 * 出题内容是否"确实引用简历经历与差距"属**人工核验**（记入《验证记录》），脚本只钉契约层。
 *
 * 运行：node tools/verify/m12-interview-context-api.mjs
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

const RESUME_TEXT = [
  '张三 / Java 后端开发',
  '技能：Java、Spring Boot、MySQL、Redis、Git',
  '项目经历：校园二手交易平台（后端负责人，2024.03-2024.09）',
  '  - 使用 Java 与 Spring Boot 实现订单与商品模块，MySQL 存储数据，Redis 做缓存',
  '工作/实习：示例科技 后端实习生（2024.07-2025.06），参与接口开发与联调',
  '教育经历：示例大学 计算机科学与技术 本科（2021-2025）',
].join('\n')

const JOB_TEXT = [
  '岗位名称：Java 后端开发实习生',
  '职责：参与核心业务系统的接口开发与维护。',
  '要求：熟悉 Java、Spring Boot、MySQL；了解 Redis；有 Docker 使用经验者优先。',
  '学历：本科及以上。经验：有实习经历优先。',
].join('\n')

const JOB_TEXT_2 = [
  '岗位名称：前端开发实习生',
  '职责：参与管理后台页面开发。',
  '要求：熟悉 Vue 3 与 TypeScript。',
].join('\n')

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

async function uploadResume(token, name) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
  const res = await api('POST', '/resumes', { token, form })
  return res.body?.data?.id
}

/** 创建面试会话（题目数取 2 控制模型成本） */
function createInterview(token, extra) {
  return api('POST', '/interviews', {
    token,
    body: { title: 'M12 验收面试', questionType: 'MIXED', questionCount: 2, ...extra },
  })
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('== 准备：注册两个账号、建岗位与简历、完成双方分析、创建一次优化 ==')
  const userA = await registerAndLogin('m12a')
  const userB = await registerAndLogin('m12b')
  check('账号注册与登录成功', Boolean(userA.token && userB.token))
  if (!userA.token || !userB.token) {
    return
  }

  const job = await api('POST', '/jobs', {
    token: userA.token,
    body: { jobName: 'Java 后端开发实习生', companyName: '示例科技', description: JOB_TEXT },
  })
  const jobId = job.body?.data?.id
  const otherJob = await api('POST', '/jobs', {
    token: userA.token,
    body: { jobName: '前端开发实习生', companyName: '示例科技', description: JOB_TEXT_2 },
  })
  const otherJobId = otherJob.body?.data?.id
  const resumeId = await uploadResume(userA.token, '验收简历')
  const secondResumeId = await uploadResume(userA.token, '第二份简历')
  check('创建岗位（两个）与上传简历（两份）成功',
    Boolean(jobId && otherJobId && resumeId && secondResumeId))
  if (!jobId || !otherJobId || !resumeId || !secondResumeId) {
    return
  }

  const resumeAnalysis = await api('POST', `/resumes/${resumeId}/analyze`, { token: userA.token })
  const jobAnalysis = await api('POST', `/jobs/${jobId}/analyze`, { token: userA.token })
  check('简历与岗位分析完成',
    resumeAnalysis.body?.code === 0 && jobAnalysis.body?.code === 0,
    `${resumeAnalysis.body?.message} / ${jobAnalysis.body?.message}`)

  const optimization = await api('POST', '/optimizations', {
    token: userA.token,
    body: { resumeId, jobId },
  })
  const optimizationId = optimization.body?.data?.id
  check('创建优化成功（匹配 + 优化生成，2 次模型调用）',
    optimization.body?.code === 0 && Boolean(optimizationId), optimization.body?.message)
  if (!optimizationId) {
    return
  }

  // ------------------------------------------------------------ 组 1：优化来源（主链路）

  console.log('\n== 组 1：从优化来源创建面试（出题参考优化稿与匹配差距，1 次模型调用） ==')
  const created = await createInterview(userA.token, { jobId, optimizationId })
  const sessionId = created.body?.data?.id
  check('携带优化创建成功', created.body?.code === 0 && Boolean(sessionId),
    created.body?.message)
  check('题目已生成', (created.body?.data?.questions?.length ?? 0) >= 1)
  if (!sessionId) {
    return
  }

  const list = await api('GET', '/interviews?page=1&size=10', { token: userA.token })
  const listItem = list.body?.data?.records?.find((item) => item.id === sessionId)
  check('列表来源字段正确（resumeId / resumeName / optimizationVersionNo）',
    listItem?.resumeId === resumeId && listItem?.resumeName === '验收简历'
      && listItem?.optimizationVersionNo === 1,
    JSON.stringify(listItem))

  const detail = await api('GET', `/interviews/${sessionId}`, { token: userA.token })
  check('详情来源字段正确',
    detail.body?.data?.resumeId === resumeId && detail.body?.data?.resumeName === '验收简历'
      && detail.body?.data?.optimizationId === optimizationId
      && detail.body?.data?.optimizationVersionNo === 1)

  const report = await api('GET', `/interviews/${sessionId}/report`, { token: userA.token })
  check('报告来源字段正确',
    report.body?.data?.resumeName === '验收简历'
      && report.body?.data?.optimizationVersionNo === 1)

  // ------------------------------------------------------------ 组 2：一致性校验（模型调用前拦截）

  console.log('\n== 组 2：一致性校验（均应在模型调用前拦截） ==')
  const mismatchJob = await createInterview(userA.token, { jobId: otherJobId, optimizationId })
  check('优化岗位与 jobId 不一致 → 400',
    mismatchJob.body?.code === 40000, `${mismatchJob.status} / ${mismatchJob.body?.message}`)

  const mismatchResume = await createInterview(userA.token, {
    jobId, optimizationId, resumeId: secondResumeId,
  })
  check('显式 resumeId 与优化不一致 → 400',
    mismatchResume.body?.code === 40000, `${mismatchResume.body?.message}`)

  const notFoundOptimization = await createInterview(userA.token, { jobId, optimizationId: 999999 })
  check('不存在的优化 → 404',
    notFoundOptimization.body?.code === 40400, `${notFoundOptimization.body?.message}`)

  // ------------------------------------------------------------ 组 3：仅简历来源

  console.log('\n== 组 3：仅简历来源创建（1 次模型调用） ==')
  const resumeOnly = await createInterview(userA.token, { jobId, resumeId })
  const resumeOnlyId = resumeOnly.body?.data?.id
  check('携带简历创建成功', resumeOnly.body?.code === 0 && Boolean(resumeOnlyId),
    resumeOnly.body?.message)
  const resumeOnlyDetail = resumeOnlyId
    ? await api('GET', `/interviews/${resumeOnlyId}`, { token: userA.token })
    : { body: null }
  check('来源字段：resumeId 有值、optimizationId 为 null',
    resumeOnlyDetail.body?.data?.resumeId === resumeId
      && resumeOnlyDetail.body?.data?.optimizationId === null)

  // ------------------------------------------------------------ 组 4：无来源（历史行为）

  console.log('\n== 组 4：无来源创建（与历史一致，1 次模型调用） ==')
  const noSource = await createInterview(userA.token, { jobId })
  const noSourceId = noSource.body?.data?.id
  check('无来源创建成功', noSource.body?.code === 0 && Boolean(noSourceId),
    noSource.body?.message)
  const noSourceDetail = noSourceId
    ? await api('GET', `/interviews/${noSourceId}`, { token: userA.token })
    : { body: null }
  check('来源字段均为 null（既有行为不变）',
    noSourceDetail.body?.data?.resumeId === null
      && noSourceDetail.body?.data?.resumeName === null
      && noSourceDetail.body?.data?.optimizationId === null
      && noSourceDetail.body?.data?.optimizationVersionNo === null)

  // ------------------------------------------------------------ 组 5：越权矩阵

  console.log('\n== 组 5：越权矩阵（不产生模型调用） ==')
  const crossOptimization = await createInterview(userB.token, { jobId, optimizationId })
  check('他人优化 → 404（B 无该岗位，先命中岗位 404 亦可）',
    crossOptimization.body?.code === 40400, `${crossOptimization.body?.message}`)

  const bJob = await api('POST', '/jobs', {
    token: userB.token,
    body: { jobName: 'B 的岗位', description: JOB_TEXT_2 },
  })
  const bJobId = bJob.body?.data?.id
  const crossOptimization2 = await createInterview(userB.token, { jobId: bJobId, optimizationId })
  check('他人优化（岗位自持）→ 404',
    crossOptimization2.body?.code === 40400, `${crossOptimization2.body?.message}`)

  const crossResume = await createInterview(userB.token, { jobId: bJobId, resumeId })
  check('他人简历 → 404', crossResume.body?.code === 40400, `${crossResume.body?.message}`)
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
