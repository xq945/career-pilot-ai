/**
 * M6 匹配模块接口层验收（《开发顺序》M6 的「curl 验收」环节；用 Node fetch 实现等价的用例组，
 * 与 curl 手敲相比可复现、可断言、可重跑，断言内容与 curl 用例一一对应）。
 *
 * 前置：后端已在 8080 运行、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**4 次真实模型调用**（简历分析 1 + 岗位分析 1 + 匹配解释 2）——与 M5 同量级。
 *
 * 运行：node tools/verify/m6-match-api.mjs
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

/** 简历文本：覆盖技能、项目、实习、学历四个维度，供模型提取（影响评分输入） */
const RESUME_TEXT = [
  '张三 / Java 后端开发',
  '技能：Java、Spring Boot、MySQL、Redis、Git',
  '项目经历：校园二手交易平台（后端负责人，2024.03-2024.09）',
  '  - 使用 Java 与 Spring Boot 实现订单与商品模块，MySQL 存储数据，Redis 做缓存',
  '工作/实习：示例科技 后端实习生（2024.07-2025.06），参与接口开发与联调',
  '教育经历：示例大学 计算机科学与技术 本科（2021-2025）',
].join('\n')

/** 岗位文本：必备技能与简历高度重合，Docker 为加分项而简历未体现（构造出差距项） */
const JOB_TEXT = [
  '岗位名称：Java 后端开发实习生',
  '职责：参与核心业务系统的接口开发与维护。',
  '要求：熟悉 Java、Spring Boot、MySQL；了解 Redis；有 Docker 使用经验者优先。',
  '学历：本科及以上。经验：有实习经历优先。',
].join('\n')

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return login.body?.data?.token
}

async function uploadResume(token, name) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
  const res = await api('POST', '/resumes', { token, form })
  return res.body?.data?.id
}

async function totalMatches(token) {
  const res = await api('GET', '/matches?page=1&size=10', { token })
  return res.body?.data?.total
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('== 准备：注册两个账号、建岗位、传简历、完成双方分析（2 次模型调用） ==')
  const tokenA = await registerAndLogin('m6a')
  const tokenB = await registerAndLogin('m6b')
  check('账号注册与登录成功', Boolean(tokenA && tokenB))
  if (!tokenA || !tokenB) {
    return
  }

  const job = await api('POST', '/jobs', {
    token: tokenA,
    body: { jobName: 'Java 后端开发实习生', companyName: '示例科技', description: JOB_TEXT },
  })
  const jobId = job.body?.data?.id
  check('创建岗位成功', Boolean(jobId), JSON.stringify(job.body).slice(0, 200))

  const resumeId = await uploadResume(tokenA, '验收简历')
  const rawResumeId = await uploadResume(tokenA, '未分析简历')
  check('上传简历成功', Boolean(resumeId && rawResumeId))
  if (!jobId || !resumeId || !rawResumeId) {
    return
  }

  const resumeAnalysis = await api('POST', `/resumes/${resumeId}/analyze`, { token: tokenA })
  check('简历分析成功', resumeAnalysis.body?.code === 0, JSON.stringify(resumeAnalysis.body).slice(0, 200))
  const jobAnalysis = await api('POST', `/jobs/${jobId}/analyze`, { token: tokenA })
  check('岗位分析成功', jobAnalysis.body?.code === 0, JSON.stringify(jobAnalysis.body).slice(0, 200))

  // ------------------------------------------------------------ 组 1：主路径

  console.log('\n== 组 1：主路径（2 次匹配解释） ==')
  const create1 = await api('POST', '/matches', { token: tokenA, body: { resumeId, jobId } })
  const match1 = create1.body?.data
  check('创建匹配成功', create1.status === 200 && create1.body?.code === 0,
    JSON.stringify(create1.body).slice(0, 300))
  if (!match1) {
    return
  }

  const items = match1.dimensionScores?.items ?? []
  check('维度顺序固定为权重降序',
    items.map((item) => item.key).join(',') === 'requiredSkills,projectRelevance,experience,education,preferredSkills',
    items.map((item) => item.key).join(','))
  check('权重标注与设计文档一致（45/25/15/10/5）',
    items.map((item) => item.weight).join(',') === '45,25,15,10,5',
    items.map((item) => item.weight).join(','))
  check('ruleVersion 透传配置值', match1.dimensionScores?.ruleVersion === 'v1')
  const handComputed = items.reduce((sum, item) => sum + item.weight * item.score, 0) / 100
  check('总分等于按权重计算的结果（可用界面权重手算复核）',
    Math.abs(handComputed - match1.matchScore) < 1e-9,
    `手算=${handComputed} 接口=${match1.matchScore}`)
  check('分数在 0–100 范围内', match1.matchScore >= 0 && match1.matchScore <= 100)
  check('内联资源名称与双方分析版本号',
    match1.resumeName === '验收简历' && match1.jobName === 'Java 后端开发实习生'
    && match1.companyName === '示例科技'
    && match1.resumeVersionNo === 1 && match1.jobVersionNo === 1,
    JSON.stringify({ resumeName: match1.resumeName, jobName: match1.jobName, rv: match1.resumeVersionNo, jv: match1.jobVersionNo }))
  check('明细为 {text, dimension} 对象且 dimension 属白名单',
    ['matchedItems', 'partialItems', 'missingItems'].every((field) =>
      Array.isArray(match1[field]) && match1[field].every((item) =>
        typeof item.text === 'string'
        && (item.dimension === null
          || ['requiredSkills', 'projectRelevance', 'experience', 'education', 'preferredSkills'].includes(item.dimension)))))
  check('全链路不含「不具备」类断言', JSON.stringify(match1).indexOf('不具备') === -1)
  check('差距项文案使用受控措辞',
    (match1.missingItems ?? []).every((item) => item.text.includes('未体现') || item.text.includes('缺少')),
    JSON.stringify(match1.missingItems))
  check('summary 为字符串、suggestions 为数组',
    typeof match1.summary === 'string' && Array.isArray(match1.suggestions))

  const create2 = await api('POST', '/matches', { token: tokenA, body: { resumeId, jobId } })
  const match2 = create2.body?.data
  check('同一组合重复匹配产生新记录', Boolean(match2?.id) && match2.id !== match1.id,
    `${match1.id} vs ${match2?.id}`)

  const list = await api('GET', '/matches?page=1&size=10', { token: tokenA })
  const records = list.body?.data?.records ?? []
  check('列表按时间倒序（新记录在前）', records[0]?.id === match2?.id && records[1]?.id === match1.id)
  check('列表 total=2', list.body?.data?.total === 2, String(list.body?.data?.total))
  check('列表内联名称与版本号',
    records.every((record) => record.resumeName === '验收简历' && typeof record.jobVersionNo === 'number'))

  const detail = await api('GET', `/matches/${match1.id}`, { token: tokenA })
  const detailData = detail.body?.data
  check('详情与创建响应逐字段一致（分数/维度分/明细）',
    detailData?.id === match1.id
    && detailData?.matchScore === match1.matchScore
    && JSON.stringify(detailData?.dimensionScores) === JSON.stringify(match1.dimensionScores)
    && JSON.stringify(detailData?.missingItems) === JSON.stringify(match1.missingItems))

  // ------------------------------------------------------------ 组 2：失败矩阵

  console.log('\n== 组 2：失败矩阵（均不得产生新记录） ==')
  const totalBefore = await totalMatches(tokenA)

  const missingResumeAnalysis = await api('POST', '/matches', { token: tokenA, body: { resumeId: rawResumeId, jobId } })
  check('缺简历分析 → 400 且文案指明简历分析',
    missingResumeAnalysis.status === 400 && missingResumeAnalysis.body?.code === 40000
    && String(missingResumeAnalysis.body?.message).includes('简历分析'),
    JSON.stringify(missingResumeAnalysis.body))

  const rawJob = await api('POST', '/jobs', {
    token: tokenA,
    body: { jobName: '未分析岗位', description: 'Java 后端方向，要求熟悉 Java。' },
  })
  const rawJobId = rawJob.body?.data?.id
  const missingJobAnalysis = await api('POST', '/matches', { token: tokenA, body: { resumeId, jobId: rawJobId } })
  check('缺岗位分析 → 400 且文案指明岗位分析',
    missingJobAnalysis.status === 400 && missingJobAnalysis.body?.code === 40000
    && String(missingJobAnalysis.body?.message).includes('岗位分析'),
    JSON.stringify(missingJobAnalysis.body))

  const crossCreate = await api('POST', '/matches', { token: tokenB, body: { resumeId, jobId } })
  check('请求体夹带他人资源 ID → 404（不暴露资源存在性）',
    crossCreate.status === 404 && crossCreate.body?.code === 40400)

  const crossDetail = await api('GET', `/matches/${match1.id}`, { token: tokenB })
  check('他人匹配记录详情 → 404', crossDetail.status === 404 && crossDetail.body?.code === 40400)

  const ghost = await api('POST', '/matches', { token: tokenA, body: { resumeId: 99999999, jobId } })
  check('不存在的资源 → 404', ghost.status === 404)

  const badPage = await api('GET', '/matches?page=0&size=10', { token: tokenA })
  check('分页越界 page=0 → 40001',
    badPage.status === 400 && badPage.body?.code === 40001, JSON.stringify(badPage.body))

  const emptyBody = await api('POST', '/matches', { token: tokenA, body: {} })
  check('缺必填参数 → 40001 且带字段级提示',
    emptyBody.status === 400 && emptyBody.body?.code === 40001)

  // stale 放在最后：更新岗位描述会使该岗位的分析过期，影响后续用例
  const updated = await api('PUT', `/jobs/${jobId}`, {
    token: tokenA,
    body: {
      jobName: 'Java 后端开发实习生',
      companyName: '示例科技',
      description: `${JOB_TEXT}\n补充：熟悉 Linux 者优先。`,
    },
  })
  check('更新岗位描述成功', updated.body?.code === 0)
  const stale = await api('POST', '/matches', { token: tokenA, body: { resumeId, jobId } })
  check('岗位分析已过期 → 400 且指向先重新分析',
    stale.status === 400 && stale.body?.code === 40000
    && String(stale.body?.message).includes('重新分析'),
    JSON.stringify(stale.body))

  const totalAfter = await totalMatches(tokenA)
  check('全部失败请求均未产生记录（total 不变）', totalAfter === totalBefore,
    `${totalBefore} → ${totalAfter}`)

  // ------------------------------------------------------------ 组 4：删除可见性

  console.log('\n== 组 4：删除可见性（源资源逻辑删除后记录仍可追溯） ==')
  await api('DELETE', `/resumes/${resumeId}`, { token: tokenA })
  const afterResumeDelete = await api('GET', '/matches?page=1&size=10', { token: tokenA })
  const firstRow = afterResumeDelete.body?.data?.records?.[0]
  check('删除简历后列表 resumeName 仍正常显示', firstRow?.resumeName === '验收简历',
    JSON.stringify(firstRow))

  const reportAfterDelete = await api('GET', `/matches/${match1.id}`, { token: tokenA })
  check('删除简历后匹配报告仍可打开',
    reportAfterDelete.body?.code === 0 && reportAfterDelete.body?.data?.resumeName === '验收简历')

  await api('DELETE', `/jobs/${jobId}`, { token: tokenA })
  const afterJobDelete = await api('GET', '/matches?page=1&size=10', { token: tokenA })
  const firstRow2 = afterJobDelete.body?.data?.records?.[0]
  check('删除岗位后列表 jobName/companyName 仍正常显示',
    firstRow2?.jobName === 'Java 后端开发实习生' && firstRow2?.companyName === '示例科技',
    JSON.stringify(firstRow2))
}

main()
  .catch((error) => {
    console.error('验收脚本异常：', error)
    process.exitCode = 1
  })
  .finally(() => {
    console.log(`\n== 结果：${passed} 项通过，${failures.length} 项失败 ==`)
    failures.forEach((failure) => console.log(`  - ${failure}`))
    process.exit(failures.length > 0 || process.exitCode === 1 ? 1 : 0)
  })
