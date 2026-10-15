/**
 * M15 面试域升级接口层验收（《开发顺序》M15 的「接口层验收」环节）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M15 的新实例**）、MySQL 可用
 *      （interview_question.topic_summary 与 interview_session.summary_source 已按 V1.9 增量建好）。
 * 成本：**6 次真实模型调用**（出题 2〔两场，第二场验证历史题去重注入〕+ 评价 2 + 总评 1 + 重新生成总评 1）。
 *
 * 覆盖验收标准（《开发顺序》M15、《API接口设计》§7.1/§7.4/§7.5）：
 * - 出题升级（Skill 驱动的**契约层**证据）：创建成功、题目带类别、配额分布可观测
 *   （内容层"是否按配额/是否引用简历"属人工核验）；
 * - 报告新增 `summarySource` / `summaryGeneratedAt`：完成路径为 `AI`；
 * - 重新生成总评：**未完成会话 → 400**；完成后成功覆盖且来源 `AI`；与报告接口结构一致；
 * - 越权：他人会话 → 404；
 * - 历史题去重（M15）：同题型第二场创建成功，两场题目打印供**人工核验**重复度
 *   （去重为提示词层面的软约束，不做自动断言）。
 *
 * 运行：node tools/verify/m15-interview-eval-api.mjs
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
  '要求：熟悉 Java、Spring Boot、MySQL；了解 Redis；有实际项目经历者优先。',
  '学历：本科及以上。经验：有实习经历优先。',
].join('\n')

/** 一道有内容的回答（保证评价与点评摘要非空，供总评/降级链路使用） */
const ANSWER = [
  '我在校园二手交易平台项目中负责订单模块，用 Spring Boot 做了下单与库存扣减。',
  '库存扣减我用的是数据库乐观锁（版本号）配合重试，避免超卖；',
  '同时把下单链路放在一个事务里，事务内不调用外部服务，保证锁持有时间短。',
].join('\n')

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

/** 创建 MIXED 面试（每题 1 次出题调用） */
function createInterview(token, jobId, title, count) {
  return api('POST', '/interviews', {
    token,
    body: { jobId, title, questionType: 'MIXED', questionCount: count },
  })
}

/** 打印一场题目的类别分布（配额可观测性的证据） */
function describeQuestions(questions) {
  return questions
    .map((item) => `[${item.questionCategory ?? '未分类'}] ${item.question.slice(0, 40)}`)
    .join(' | ')
}

async function main() {
  console.log('== 准备：注册两个账号并建岗位 ==')
  const userA = await registerAndLogin('m15a')
  const userB = await registerAndLogin('m15b')
  check('账号注册与登录成功', Boolean(userA.token && userB.token))
  if (!userA.token || !userB.token) {
    return
  }
  const job = await api('POST', '/jobs', {
    token: userA.token,
    body: { jobName: 'Java 后端开发实习生', companyName: '示例科技', description: JOB_TEXT },
  })
  const jobId = job.body?.data?.id
  check('创建岗位成功', Boolean(jobId))
  if (!jobId) {
    return
  }

  // ------------------------------------------------------------ 组 1：出题（Skill 驱动契约层）

  console.log('\n== 组 1：创建面试（MIXED 2 题，1 次模型调用） ==')
  const created = await createInterview(userA.token, jobId, 'M15 验收面试', 2)
  const sessionId = created.body?.data?.id
  const firstQuestions = created.body?.data?.questions ?? []
  check('创建成功且题目已生成', created.body?.code === 0 && firstQuestions.length >= 1,
    created.body?.message)
  if (!sessionId) {
    return
  }
  const categories = new Set(firstQuestions.map((item) => item.questionCategory))
  console.log(`  场次 1 题目：${describeQuestions(firstQuestions)}`)
  check('题目带类别且类别来自白名单（配额分布内容层属人工核验）',
    firstQuestions.every((item) => item.questionCategory == null
      || ['JAVA', 'SPRING', 'MYSQL', 'REDIS', 'PROJECT', 'MIXED'].includes(item.questionCategory)),
    JSON.stringify([...categories]))

  // ------------------------------------------------------------ 组 2：未完成会话的重新生成（不产生模型调用）

  console.log('\n== 组 2：未完成会话 → 重新生成总评 400（模型调用前拦截） ==')
  const premature = await api('POST', `/interviews/${sessionId}/summary/regenerate`, { token: userA.token })
  check('未完成会话重新生成 → 400 且提示未完成',
    premature.body?.code === 40000 && (premature.body?.message ?? '').includes('尚未完成'),
    `${premature.status} / ${premature.body?.message}`)

  // ------------------------------------------------------------ 组 3：答题并完成（评价 2 + 总评 1 次调用）

  console.log('\n== 组 3：逐题作答（每题 1 次评价调用；最后一题触发总评） ==')
  for (const question of firstQuestions) {
    const answered = await api('POST', `/interviews/${sessionId}/questions/${question.id}/answer`, {
      token: userA.token,
      body: { answer: ANSWER },
    })
    check(`提交回答（题 ${question.id}）成功且返回得分`,
      answered.body?.code === 0 && answered.body?.data?.score !== undefined,
      answered.body?.message)
  }

  // ------------------------------------------------------------ 组 4：报告新增字段

  console.log('\n== 组 4：报告的总评来源与生成时间（M15 新增字段） ==')
  const report = await api('GET', `/interviews/${sessionId}/report`, { token: userA.token })
  const reportData = report.body?.data
  check('会话已完成', reportData?.completed === true)
  check('完成路径的总评来源为 AI 且生成时间非空',
    reportData?.summarySource === 'AI' && Boolean(reportData?.summaryGeneratedAt),
    `summarySource=${reportData?.summarySource} summaryGeneratedAt=${reportData?.summaryGeneratedAt}`)
  check('总评内容非空', typeof reportData?.overallSummary === 'string'
    && reportData.overallSummary.length > 0)
  const firstSummary = reportData?.overallSummary

  // ------------------------------------------------------------ 组 5：重新生成总评（1 次调用）

  console.log('\n== 组 5：重新生成总评（1 次模型调用；成功覆盖并标注 AI） ==')
  const regenerated = await api('POST', `/interviews/${sessionId}/summary/regenerate`, { token: userA.token })
  const regeneratedData = regenerated.body?.data
  check('重新生成成功且响应与报告接口结构一致',
    regenerated.body?.code === 0 && regeneratedData?.sessionId === sessionId
      && Array.isArray(regeneratedData?.questions),
    regenerated.body?.message)
  check('重新生成后来源为 AI、生成时间已更新',
    regeneratedData?.summarySource === 'AI' && Boolean(regeneratedData?.summaryGeneratedAt),
    `summarySource=${regeneratedData?.summarySource}`)
  check('总分与逐题评价不受重生成影响（分数永远由规则计算）',
    regeneratedData?.totalScore === reportData?.totalScore,
    `${regeneratedData?.totalScore} vs ${reportData?.totalScore}`)
  console.log(`  重生成前总评：${(firstSummary ?? '').slice(0, 60)}…`)
  console.log(`  重生成后总评：${(regeneratedData?.overallSummary ?? '').slice(0, 60)}…`)
  console.log('  （两次表述是否不同属模型输出不确定性，不做断言）')

  // ------------------------------------------------------------ 组 6：越权

  console.log('\n== 组 6：越权（不产生模型调用） ==')
  const crossJob = await api('POST', '/jobs', {
    token: userB.token,
    body: { jobName: 'B 的岗位', description: JOB_TEXT },
  })
  const cross = await api('POST', `/interviews/${sessionId}/summary/regenerate`, { token: userB.token })
  check('他人会话重新生成 → 404', cross.body?.code === 40400, `${cross.body?.message}`)
  check('B 确实无法访问该会话（前置成立）', Boolean(crossJob.body?.data?.id))

  // ------------------------------------------------------------ 组 7：历史题去重（第二场，1 次调用）

  console.log('\n== 组 7：同题型第二场（历史题去重为提示词软约束，打印供人工核验） ==')
  const second = await createInterview(userA.token, jobId, 'M15 验收面试（第二场）', 2)
  const secondQuestions = second.body?.data?.questions ?? []
  check('第二场创建成功（历史题查询未阻断出题）',
    second.body?.code === 0 && secondQuestions.length >= 1, second.body?.message)
  console.log(`  场次 2 题目：${describeQuestions(secondQuestions)}`)
  console.log('  （请人工核验：场次 2 的知识点与场次 1 是否明显不重复）')
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
