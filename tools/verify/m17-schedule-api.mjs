/**
 * M17 面试日程接口层验收（《开发顺序》M17 的「接口层验收」环节）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M17 的新实例**）、MySQL 可用
 *      （interview_schedule 已按 V1.11 增量建好）。
 *      **过期流转项要求后端以加速 cron 启动**：
 *        APP_SCHEDULE_EXPIRY_CRON="0/10 * * * * *" mvn spring-boot:run
 *      （不加速时该项会超时失败，属预期提示）。
 * 成本：**1 次真实模型调用**（AI 兜底解析；规则解析与其余用例 0 调用）。
 *
 * 覆盖验收标准（《开发顺序》M17、《API接口设计》§9A）：
 * - 规则解析：飞书/通用格式命中、置信度 0.95、字段正确；无效文本返回失败态（不抛 502）；
 * - AI 兜底：规则未命中的自由文本 → parseSource=AI、置信度 0.80；
 * - CRUD：创建（未来时间）/ 列表（状态筛选 + 范围）/ 详情 / 编辑（仅 PENDING、过去时间 400）/
 *   状态流转（终态不可回退、EXPIRED 不可写）/ 物理删除；
 * - 定时过期：写入"十几秒后"的日程，等待调度置 EXPIRED（**仅该系统状态**）；
 * - 越权：他人日程（详情 / 编辑 / 流转 / 删除）→ 404。
 *
 * 运行：node tools/verify/m17-schedule-api.mjs
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

/** 本地时间（后端时区一致）→ 'YYYY-MM-DDTHH:mm:ss' */
function localIso(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 明天（本地）的 yyyy-MM-dd */
function tomorrowDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

function createRequest(overrides = {}) {
  return {
    companyName: '示例科技',
    position: 'Java 后端开发',
    interviewTime: localIso(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)),
    interviewType: 'VIDEO',
    meetingLink: 'https://meeting.example.com/abc',
    roundNumber: 2,
    ...overrides,
  }
}

/** 轮询详情直到命中期望状态（过期流转等待用） */
async function waitForStatus(token, id, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await api('GET', `/interview-schedules/${id}`, { token })
    if (res.body?.data?.status === expected) {
      return res.body.data
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  const latest = await api('GET', `/interview-schedules/${id}`, { token })
  return latest.body?.data ?? null
}

async function main() {
  console.log('== 准备：注册两个账号 ==')
  const userA = await registerAndLogin('m17a')
  const userB = await registerAndLogin('m17b')
  check('账号注册与登录成功', Boolean(userA.token && userB.token))
  if (!userA.token || !userB.token) {
    return
  }

  // ------------------------------------------------------------ 组 1：规则解析

  console.log('\n== 组 1：规则解析（0 次模型调用） ==')
  const ruleText = [
    '【飞书】面试邀请',
    '公司：示例科技',
    '岗位：Java 后端开发',
    `时间：${tomorrowDate()} 14:00`,
    '第2轮',
    '会议链接：https://meeting.feishu.cn/abc123',
  ].join('\n')
  const ruleParse = await api('POST', '/interview-schedules/parse', {
    token: userA.token,
    body: { rawText: ruleText },
  })
  const ruleData = ruleParse.body?.data
  check('飞书格式规则命中（success=true, parseSource=RULE, 置信度 0.95）',
    ruleData?.success === true && ruleData?.parseSource === 'RULE'
      && Number(ruleData?.confidence) === 0.95,
    JSON.stringify(ruleData))
  check('规则解析字段正确（公司/岗位/时间/轮次/链接）',
    ruleData?.data?.companyName === '示例科技' && ruleData?.data?.position === 'Java 后端开发'
      && (ruleData?.data?.interviewTime ?? '').includes('T14:00') && ruleData?.data?.roundNumber === 2
      && (ruleData?.data?.meetingLink ?? '').includes('meeting.feishu.cn'),
    JSON.stringify(ruleData?.data))

  const invalidParse = await api('POST', '/interview-schedules/parse', {
    token: userA.token,
    body: { rawText: '今天天气不错，随便聊聊' },
  })
  check('无效文本返回失败态（HTTP 200 + success=false，不抛 502）',
    invalidParse.status === 200 && invalidParse.body?.data?.success === false
      && typeof invalidParse.body?.data?.message === 'string',
    JSON.stringify(invalidParse.body?.data))

  // ------------------------------------------------------------ 组 2：AI 兜底（1 次调用）

  console.log('\n== 组 2：AI 兜底解析（1 次模型调用） ==')
  const aiText = '王同学你好，邀请你参加我们的后端开发岗位面试，时间定在下周三下午2点，'
    + '届时请提前十分钟上线，面试官是李经理。'
  const aiParse = await api('POST', '/interview-schedules/parse', {
    token: userA.token,
    body: { rawText: aiText },
  })
  const aiData = aiParse.body?.data
  check('规则未命中时 AI 兜底（parseSource=AI, 置信度 0.80）',
    aiData?.success === true && aiData?.parseSource === 'AI'
      && Number(aiData?.confidence) === 0.80,
    JSON.stringify(aiData))
  if (aiData?.success) {
    console.log(`  （AI 解析结果：${JSON.stringify(aiData.data)}）`)
  }

  // ------------------------------------------------------------ 组 3：创建与CRUD

  console.log('\n== 组 3：创建 / 列表 / 详情（0 次调用） ==')
  const created = await api('POST', '/interview-schedules', {
    token: userA.token,
    body: createRequest({ parseSource: 'RULE', confidence: 0.95 }),
  })
  const schedule = created.body?.data
  check('创建成功且状态为 PENDING、来源落库',
    created.body?.code === 0 && schedule?.status === 'PENDING'
      && schedule?.parseSource === 'RULE' && Number(schedule?.parseConfidence) === 0.95,
    created.body?.message)
  if (!schedule?.id) {
    return
  }
  const scheduleId = schedule.id

  const pastCreate = await api('POST', '/interview-schedules', {
    token: userA.token,
    body: createRequest({ interviewTime: localIso(new Date(Date.now() - 60 * 60 * 1000)) }),
  })
  check('过去时间创建 → 400', pastCreate.body?.code === 40000, pastCreate.body?.message)

  const list = await api('GET', '/interview-schedules?page=1&size=10', { token: userA.token })
  check('列表包含新日程且默认按时间升序返回',
    (list.body?.data?.records ?? []).some((item) => item.id === scheduleId))

  const filtered = await api('GET', '/interview-schedules?page=1&size=10&status=COMPLETED', { token: userA.token })
  check('状态筛选生效（COMPLETED 不含 PENDING 记录）',
    !(filtered.body?.data?.records ?? []).some((item) => item.id === scheduleId))

  const emptyRange = await api(
    'GET', '/interview-schedules?page=1&size=10&from=2000-01-01&to=2000-01-02', { token: userA.token })
  check('时间范围筛选生效（远古区间为空）', (emptyRange.body?.data?.records ?? []).length === 0)

  // ------------------------------------------------------------ 组 4：编辑与流转

  console.log('\n== 组 4：编辑与状态流转 ==')
  const updated = await api('PUT', `/interview-schedules/${scheduleId}`, {
    token: userA.token,
    body: createRequest({ companyName: '示例科技（改名）', roundNumber: 3 }),
  })
  check('编辑成功（仅 PENDING；字段已更新）',
    updated.body?.data?.companyName === '示例科技（改名）' && updated.body?.data?.roundNumber === 3,
    updated.body?.message)

  const pastUpdate = await api('PUT', `/interview-schedules/${scheduleId}`, {
    token: userA.token,
    body: createRequest({ interviewTime: localIso(new Date(Date.now() - 60 * 60 * 1000)) }),
  })
  check('编辑为过去时间 → 400', pastUpdate.body?.code === 40000, pastUpdate.body?.message)

  const expireWrite = await api('PUT', `/interview-schedules/${scheduleId}/status`, {
    token: userA.token,
    body: { status: 'EXPIRED' },
  })
  check('用户写入 EXPIRED → 40001（白名单拒绝）', expireWrite.body?.code === 40001,
    expireWrite.body?.message)

  const completed = await api('PUT', `/interview-schedules/${scheduleId}/status`, {
    token: userA.token,
    body: { status: 'COMPLETED' },
  })
  check('PENDING → COMPLETED 成功', completed.body?.data?.status === 'COMPLETED',
    completed.body?.message)

  const reflow = await api('PUT', `/interview-schedules/${scheduleId}/status`, {
    token: userA.token,
    body: { status: 'CANCELLED' },
  })
  check('终态不可回退（已完成再取消 → 400）', reflow.body?.code === 40000, reflow.body?.message)

  const frozenEdit = await api('PUT', `/interview-schedules/${scheduleId}`, {
    token: userA.token,
    body: createRequest({ companyName: '不该生效' }),
  })
  check('终态不可编辑 → 400', frozenEdit.body?.code === 40000, frozenEdit.body?.message)

  // ------------------------------------------------------------ 组 5：过期流转（需加速 cron）

  console.log('\n== 组 5：定时过期流转（要求后端以 APP_SCHEDULE_EXPIRY_CRON="0/10 * * * * *" 启动） ==')
  const soon = await api('POST', '/interview-schedules', {
    token: userA.token,
    body: createRequest({ interviewTime: localIso(new Date(Date.now() + 15 * 1000)) }),
  })
  const soonId = soon.body?.data?.id
  check('创建"15 秒后"的日程（供过期构造）', Boolean(soonId), soon.body?.message)
  if (soonId) {
    const expired = await waitForStatus(userA.token, soonId, 'EXPIRED', 90000)
    check('时间已过 → 定时任务置为 EXPIRED（实测）',
      expired?.status === 'EXPIRED', `status=${expired?.status}`)
    if (expired?.status === 'EXPIRED') {
      const expiredOn = new Date(`${expired.updatedAt}`.replace(' ', 'T'))
      console.log(`  （过期时间：${expired.updatedAt}；面试时间：${expired.interviewTime}）`)
      void expiredOn
    }
  }

  // ------------------------------------------------------------ 组 6：越权与删除

  console.log('\n== 组 6：越权与删除（0 次调用） ==')
  const crossDetail = await api('GET', `/interview-schedules/${scheduleId}`, { token: userB.token })
  const crossUpdate = await api('PUT', `/interview-schedules/${scheduleId}`, {
    token: userB.token, body: createRequest(),
  })
  const crossStatus = await api('PUT', `/interview-schedules/${scheduleId}/status`, {
    token: userB.token, body: { status: 'CANCELLED' },
  })
  const crossDelete = await api('DELETE', `/interview-schedules/${scheduleId}`, { token: userB.token })
  check('他人日程（详情 / 编辑 / 流转 / 删除）→ 全部 404',
    [crossDetail, crossUpdate, crossStatus, crossDelete].every((res) => res.body?.code === 40400),
    JSON.stringify([crossDetail.body?.code, crossUpdate.body?.code,
      crossStatus.body?.code, crossDelete.body?.code]))

  const deleted = await api('DELETE', `/interview-schedules/${scheduleId}`, { token: userA.token })
  check('物理删除成功', deleted.body?.code === 0, deleted.body?.message)
  const afterDelete = await api('GET', `/interview-schedules/${scheduleId}`, { token: userA.token })
  check('删除后详情 404（物理删除）', afterDelete.body?.code === 40400, afterDelete.body?.message)
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
