/**
 * M8 求职智能体接口层验收 · 异常链路（AG-05 模型超时、总时长截断路径）。
 *
 * 与 m8-agent-api.mjs 分开的原因：本组需要后端**刻意以受限配置启动**，属一次性验证手法。
 * 两种模式（用环境变量切换，各需一次对应的启动）：
 *
 *   read    （默认）AG-05：模型调用超时 → 502/50200，**不创建会话、不写入任何消息**
 *           启动：--spring.http.clients.read-timeout=1ms
 *           运行：node tools/verify/m8-ai-timeout.mjs
 *
 *   budget  总时长截断：--app.agent.total-timeout-millis=1 时，工具被执行边界拒绝，
 *           模型基于已有信息收尾 → truncated=true，且该轮**照常落库**（R05：截断属成功路径）
 *           启动：--app.agent.total-timeout-millis=1
 *           运行：M8_TIMEOUT_MODE=budget node tools/verify/m8-ai-timeout.mjs
 *
 * 两种模式验证完成后都须用正常配置重启后端。
 * 成本：read 模式约 1–2 次失败调用；budget 模式约 2–3 次调用（工具被拒后模型仍需收尾）。
 *
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'
const MODE = process.env.M8_TIMEOUT_MODE ?? 'read'
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
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

async function registerAndLogin() {
  const username = `m8t_${Date.now().toString(36)}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  if (login.body?.code !== 0) {
    console.error(`❌ 测试账号登录失败：${login.body?.message}`)
    process.exit(1)
  }
  return { username, token: login.body.data.token }
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

const RESUME_TEXT = '姓名：李四。本科，软件工程专业。技能：Java、Spring Boot、MySQL。'
  + '项目：电商后台管理系统开发，负责用户与商品模块。'

async function main() {
  console.log(`M8 异常链路验收（后端 ${BASE}，模式 ${MODE}）\n`)

  const account = await registerAndLogin()
  console.log(`账号 ${account.username}\n`)

  const before = (await api('GET', '/agent/sessions?page=1&size=10', { token: account.token }))
    .body?.data?.total ?? 0

  if (MODE === 'read') {
    // ---------------------------------------------------- AG-05：模型超时
    const result = await api('POST', '/agent/chat', {
      token: account.token,
      body: { message: '帮我分析一下我的简历，并给出建议' },
    })
    check('AG-05 模型超时 → 502 / 50200',
      result.status === 502 && result.body?.code === 50200,
      `status=${result.status} code=${result.body?.code} message=${result.body?.message}`)

    const after = (await api('GET', '/agent/sessions?page=1&size=10', { token: account.token }))
      .body?.data?.total ?? 0
    check('AG-05 失败不创建会话（会话 total 不变）', after === before, `total ${before} → ${after}`)
  }
  else if (MODE === 'budget') {
    // ---------------------------------------------------- 总时长截断（truncated 成功路径）
    const resumeId = await uploadResume(account.token, '超时验收简历', RESUME_TEXT)
    const result = await api('POST', '/agent/chat', {
      token: account.token,
      body: { message: '帮我分析一下这份简历', resumeId },
    })
    check('总时长截断：对话仍成功返回（截断属成功路径）', result.body?.code === 0,
      `code=${result.body?.code} message=${result.body?.message}`)
    check('总时长截断：truncated = true', result.body?.data?.truncated === true,
      `truncated=${result.body?.data?.truncated}`)
    check('总时长截断：工具调用未被记录（被拒绝的调用不执行）',
      (result.body?.data?.toolCalls?.length ?? -1) === 0,
      `tools=${JSON.stringify(result.body?.data?.toolCalls)}`)

    const sessionId = result.body?.data?.sessionId
    const detail = await api('GET', `/agent/sessions/${sessionId}`, { token: account.token })
    const messages = detail.body?.data?.messages ?? []
    check('总时长截断：该轮照常落库（含用户与助手消息）',
      messages.some((item) => item.role === 'user')
      && messages.some((item) => item.role === 'assistant'),
      `messages=${messages.map((item) => item.role).join(',')}`)

    const analysis = await api('GET', `/resumes/${resumeId}/analysis`, { token: account.token })
    check('总时长截断：被拒绝的工具未产生副作用（简历仍未分析）',
      analysis.body?.data?.analyzed === false)
  }
  else {
    console.error(`❌ 未知模式：${MODE}（可选 read / budget）`)
    process.exit(1)
  }

  console.log(`\n共 ${passed + failures.length} 项断言，通过 ${passed}，失败 ${failures.length}`)
  if (failures.length > 0) {
    console.log('\n失败项：')
    for (const item of failures) {
      console.log(`  - ${item}`)
    }
  }
  console.log('\n（验证完成后请用正常配置重启后端）')
  return failures.length
}

const failedCount = await main().catch((error) => {
  console.error('脚本异常：', error)
  return 1
})
process.exit(failedCount > 0 ? 1 : 0)
