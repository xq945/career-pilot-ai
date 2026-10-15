/**
 * M16 创建优化异步链路接口层验收（《开发顺序》M16 的「接口层验收」环节）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M16 的新实例**，且 Redis 可用、消费者已启动）、
 *      MySQL 可用（resume_optimization 已按 V1.10 增量升级）。
 * 成本：**4 次真实模型调用**（简历分析 1 + 岗位分析 1 + 优化任务 #1 的匹配解释与生成 2；
 *      任务 #2 与重试在模型调用前即失败，不产生消耗）。
 *
 * 覆盖验收标准（《开发顺序》M16、《API接口设计》§6A.1/§6A.7）：
 * - 异步受理：创建接口**立即**返回（< 5 秒）`status = PENDING`，模型调用不在请求线程内；
 * - 未完成态详情：产物字段为空、任务控制字段就位；PENDING 不可重试（400）；
 * - 后台完成：轮询至 `SUCCESS`，详情装配完整（分数/内容/差距，stage 清空、finishedAt 就位）；
 * - **失败与重试链路**（自动化构造，无需受限配置）：任务 #2 创建后在队列中排队时改动岗位描述
 *   → 执行期防御性校验失败 → `FAILED` + 可读原因；手动重试被受理（重新 PENDING）→ 再次 FAILED；
 * - 重试规则：非 FAILED（PENDING / SUCCESS）→ 400；越权：他人任务 → 404。
 *
 * 运行：node tools/verify/m16-optimization-async-api.mjs
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
  const res = await fetch(BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(150000) })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

const SUFFIX = Date.now().toString(36)

const JOB_TEXT = [
  '岗位名称：Java 后端开发实习生',
  '职责：参与核心业务系统的接口开发与维护。',
  '要求：熟悉 Java、Spring Boot、MySQL；了解 Redis。',
].join('\n')

const RESUME_TEXT = [
  '张三 / Java 后端开发',
  '技能：Java、Spring Boot、MySQL、Redis',
  '项目经历：校园二手交易平台（后端负责人，2024.03-2024.09）',
  '教育经历：示例大学 计算机科学与技术 本科（2021-2025）',
].join('\n')

/** 轮询任务详情直到终态（SUCCESS/FAILED）；返回 { detail, elapsedMs, sawStage } */
async function waitForTask(token, id, timeoutMs = 240000) {
  const startedAt = Date.now()
  let sawStage = null
  while (Date.now() - startedAt < timeoutMs) {
    const res = await api('GET', `/optimizations/${id}`, { token })
    const detail = res.body?.data
    if (detail?.stage) {
      sawStage = detail.stage
    }
    if (detail && (detail.status === 'SUCCESS' || detail.status === 'FAILED')) {
      return { detail, elapsedMs: Date.now() - startedAt, sawStage }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`任务超时未落终态：id=${id}`);
}

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

async function main() {
  console.log('== 准备：注册账号、建立简历/岗位与双方分析（2 次模型调用） ==')
  const userA = await registerAndLogin('m16a')
  const userB = await registerAndLogin('m16b')
  check('账号注册与登录成功', Boolean(userA.token && userB.token))
  if (!userA.token || !userB.token) {
    return
  }
  const job = await api('POST', '/jobs', {
    token: userA.token,
    body: { jobName: 'Java 后端开发实习生', companyName: '示例科技', description: JOB_TEXT },
  })
  const jobId = job.body?.data?.id
  const resumeForm = new FormData()
  resumeForm.append('name', 'M16 验收简历')
  resumeForm.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
  const resumeRes = await fetch(`${BASE}/resumes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.token}` },
    body: resumeForm,
  }).then((r) => r.json())
  const resumeId = resumeRes?.data?.id
  check('建立岗位与简历成功', Boolean(jobId && resumeId))
  if (!jobId || !resumeId) {
    return
  }
  const a1 = await api('POST', `/resumes/${resumeId}/analyze`, { token: userA.token })
  const a2 = await api('POST', `/jobs/${jobId}/analyze`, { token: userA.token })
  check('简历与岗位分析完成', a1.body?.code === 0 && a2.body?.code === 0,
    `${a1.body?.message} / ${a2.body?.message}`)

  // ------------------------------------------------------------ 组 1：异步受理

  console.log('\n== 组 1：创建接口立即受理（异步任务，不在请求内等模型） ==')
  const t0 = Date.now()
  const created1 = await api('POST', '/optimizations', {
    token: userA.token,
    body: { resumeId, jobId },
  })
  const acceptMs = Date.now() - t0
  const task1 = created1.body?.data
  check('创建接口立即返回（受理耗时 < 5 秒，实测 ' + acceptMs + ' ms）', acceptMs < 5000,
    `耗时 ${acceptMs} ms`)
  check('受理响应 status = PENDING（模型调用转入后台）', task1?.status === 'PENDING',
    `status=${task1?.status}`)
  check('未完成态：产物字段为空、任务控制字段就位',
    task1?.optimizedContent === null && task1?.matchId === null
      && typeof task1?.createdAt === 'string',
    JSON.stringify({ content: task1?.optimizedContent, matchId: task1?.matchId }))
  if (!task1?.id) {
    return
  }

  const prematureRetry = await api('POST', `/optimizations/${task1.id}/retry`, { token: userA.token })
  check('PENDING 任务不可重试 → 400', prematureRetry.body?.code === 40000,
    prematureRetry.body?.message)

  // ------------------------------------------------------------ 组 2：排队中的任务 #2（失败路径的构造）

  console.log('\n== 组 2：创建排队中的任务 #2，并改动岗位描述（构造执行期失败） ==')
  const created2 = await api('POST', '/optimizations', {
    token: userA.token,
    body: { resumeId, jobId },
  })
  const task2 = created2.body?.data
  check('任务 #2 受理成功（进入队列排队）', created2.body?.code === 0 && task2?.status === 'PENDING',
    created2.body?.message)

  const updated = await api('PUT', `/jobs/${jobId}`, {
    token: userA.token,
    body: { jobName: 'Java 后端开发实习生', companyName: '示例科技',
      description: JOB_TEXT + '\n补充：有 Docker 使用经验者优先。' },
  })
  check('岗位描述已更新（任务 #2 执行时将判定分析过期）', updated.body?.code === 0,
    updated.body?.message)

  // ------------------------------------------------------------ 组 3：任务 #1 正常完成

  console.log('\n== 组 3：轮询任务 #1 至 SUCCESS（后台执行匹配 + 生成） ==')
  const r1 = await waitForTask(userA.token, task1.id)
  check('任务 #1 完成（SUCCESS，耗时 ' + Math.round(r1.elapsedMs / 1000) + ' 秒）',
    r1.detail.status === 'SUCCESS', `status=${r1.detail.status} error=${r1.detail.errorMessage}`)
  if (r1.detail.status === 'SUCCESS') {
    check('完成后详情装配完整（分数 / 内容 / 差距 / 版本号）',
      r1.detail.matchScore > 0 && typeof r1.detail.optimizedContent === 'string'
        && r1.detail.optimizedContent.length > 50 && Array.isArray(r1.detail.changes)
        && r1.detail.versionNo === 1,
      JSON.stringify({ score: r1.detail.matchScore, versionNo: r1.detail.versionNo }))
    check('终态清空任务控制字段（stage=null、errorMessage=null）',
      r1.detail.stage === null && r1.detail.errorMessage === null,
      JSON.stringify({ stage: r1.detail.stage, error: r1.detail.errorMessage }))
    if (r1.sawStage) {
      console.log(`  （轮询观测到阶段：${r1.sawStage}）`)
    }
  }
  const successRetry = await api('POST', `/optimizations/${task1.id}/retry`, { token: userA.token })
  check('SUCCESS 任务不可重试 → 400', successRetry.body?.code === 40000, successRetry.body?.message)

  // ------------------------------------------------------------ 组 4：任务 #2 失败与手动重试

  console.log('\n== 组 4：任务 #2 执行期校验失败（FAILED）与手动重试 ==')
  const r2 = await waitForTask(userA.token, task2.id)
  check('任务 #2 落 FAILED（岗位分析过期，模型调用前拦截）',
    r2.detail.status === 'FAILED', `status=${r2.detail.status}`)
  check('失败原因用户可读（含"失效或已过期"）',
    typeof r2.detail.errorMessage === 'string' && r2.detail.errorMessage.includes('失效'),
    String(r2.detail.errorMessage))

  const retried = await api('POST', `/optimizations/${task2.id}/retry`, { token: userA.token })
  check('FAILED 任务重试被受理（重新 PENDING）', retried.body?.code === 0
    && retried.body?.data?.status === 'PENDING', retried.body?.message)
  const r2b = await waitForTask(userA.token, task2.id)
  check('重试后再次落 FAILED（岗位描述仍未恢复），错误信息保持可读',
    r2b.detail.status === 'FAILED' && typeof r2b.detail.errorMessage === 'string'
      && r2b.detail.errorMessage.length > 0,
    `status=${r2b.detail.status} error=${r2b.detail.errorMessage}`)

  // ------------------------------------------------------------ 组 5：越权与列表

  console.log('\n== 组 5：越权与列表一致性（不产生模型调用） ==')
  const crossRetry = await api('POST', `/optimizations/${task2.id}/retry`, { token: userB.token })
  check('他人任务重试 → 404', crossRetry.body?.code === 40400, crossRetry.body?.message)

  const list = await api('GET', '/optimizations?page=1&size=10', { token: userA.token })
  const records = list.body?.data?.records ?? []
  const statusById = Object.fromEntries(records.map((item) => [item.id, item.status]))
  check('列表包含两条任务且状态与详情一致',
    statusById[task1.id] === 'SUCCESS' && statusById[task2.id] === 'FAILED',
    JSON.stringify(statusById))
  console.log('\n提示：任务 #2 处于 FAILED 属于本脚本的**有意构造**（验证失败与重试链路）；')
  console.log('      若要恢复该岗位，可重新分析岗位后再次重试。')
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
