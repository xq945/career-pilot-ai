/**
 * M7 面试模块接口层验收 · D 组：AI 异常链路。
 *
 * 与 m7-interview-api.mjs 分开的原因：本组需要后端**刻意以短读超时启动**，属于一次性验证手法——
 *   java -jar target/career-pilot-server-0.0.1-SNAPSHOT.jar --spring.http.clients.read-timeout=1ms
 * 验证完成后须用正常配置重启。手法与《测试与验收方案》2.3 一致（M4/M5/M6 沿用）。
 *
 * 覆盖两条规则：
 *   1. **出题失败不产生空会话**（创建会话 50200 后，面试列表 total 不变）；
 *   2. **评价失败整体不入库**（对既有进行中会话的未答题提交回答 50200 后，该题仍无回答与评价）。
 *      第 2 条需要一个「进行中且仍有未作答题目」的会话作为前置（可用 demo 账号在正常配置下
 *      先创建一场面试，只答一部分）；无此前置时脚本跳过并对第 1 条判定成败。
 *
 * 成本：2 次"失败"的模型调用（上游可能已处理，按实际计费为准）。
 *
 * 运行：node tools/verify/m7-ai-timeout.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'
const ACCOUNT = process.env.VERIFY_ACCOUNT ?? 'demo'
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'demo1234'

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

async function main() {
  const login = await api('POST', '/auth/login', { body: { account: ACCOUNT, password: PASSWORD } })
  const token = login.body?.data?.token
  console.log(`登录账号 ${ACCOUNT}：${token ? '成功' : '失败'}\n`)
  if (!token) {
    process.exit(1)
  }

  const jobs = (await api('GET', '/jobs?page=1&size=100', { token })).body?.data?.records ?? []
  const job = jobs[0]
  if (!job) {
    console.error('❌ 该账号没有岗位，无法验证创建链路（请先跑 tools/seed/demo-data.mjs）')
    process.exit(1)
  }

  // ---------------------------------------------------------- 1. 出题失败不产生空会话

  const sessionsBefore = (await api('GET', '/interviews?page=1&size=10', { token })).body?.data?.total

  const started = Date.now()
  const created = await api('POST', '/interviews', {
    token,
    body: { jobId: job.id, title: '超时验收（不应落库）', questionType: 'JAVA', questionCount: 2 },
  })
  const elapsed = Date.now() - started

  check('D1 出题读超时 → 502 / 50200',
    created.status === 502 && created.body?.code === 50200,
    `耗时 ${elapsed}ms · status=${created.status} code=${created.body?.code} message=${created.body?.message}`)

  const sessionsAfter = (await api('GET', '/interviews?page=1&size=10', { token })).body?.data?.total
  check('D2 失败不产生空会话（面试列表 total 不变）',
    sessionsAfter === sessionsBefore, `total ${sessionsBefore} → ${sessionsAfter}`)

  // ---------------------------------------------------------- 2. 评价失败整体不入库

  const ongoing = ((await api('GET', '/interviews?page=1&size=100', { token })).body?.data?.records ?? [])
    .find((item) => item.status === 0 && item.answeredCount < item.generatedCount)

  if (!ongoing) {
    console.log('  [SKIP] D3 评价失败不入库：该账号没有「进行中且仍有未作答题」的会话')
    console.log('         （前置：正常配置下先创建一场面试并只作答一部分）')
  }
  else {
    const detail = (await api('GET', `/interviews/${ongoing.id}`, { token })).body?.data
    const unanswered = detail.questions.find((question) => question.answer === null)

    const evaluated = await api('POST', `/interviews/${ongoing.id}/questions/${unanswered.id}/answer`, {
      token,
      body: { answer: '这条回答不应被写入（评价阶段会超时）' },
    })
    check('D3 评价读超时 → 502 / 50200',
      evaluated.status === 502 && evaluated.body?.code === 50200,
      `status=${evaluated.status} code=${evaluated.body?.code}`)

    const after = (await api('GET', `/interviews/${ongoing.id}`, { token })).body?.data
    const sameQuestion = after.questions.find((question) => question.id === unanswered.id)
    check('D4 评价失败整体不入库（该题回答/得分/点评仍为 null）',
      sameQuestion.answer === null && sameQuestion.score === null
        && sameQuestion.analysis === null && sameQuestion.referenceAnswer === null,
      JSON.stringify({
        answer: sameQuestion.answer, score: sameQuestion.score, analysis: sameQuestion.analysis,
      }))
  }

  // ---------------------------------------------------------- 汇总

  console.log(`\n${'—'.repeat(60)}`)
  console.log(`共 ${passed + failures.length} 项断言，通过 ${passed}，失败 ${failures.length}`)
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
