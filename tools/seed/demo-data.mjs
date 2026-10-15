/**
 * 演示 / 测试数据种子脚本。
 *
 * **全部通过后端 API 创建**（注册 → 上传简历 / 创建岗位 → 真实 AI 分析），而非直接写库，
 * 因此页面看到的数据与真实使用流程完全一致（含真实的模型分析结果）。
 *
 * 幂等：脚本先删除目标账号现有的全部简历与岗位（逻辑删除，列表随即变空）再重新创建，
 * 可反复执行（重复执行会消耗新的模型调用）。
 *
 * 岗位数据刻意覆盖**分析状态三态**，便于演示与答辩：
 * - 已分析（`analyzed` 且不过期）；「分析已过期」（分析后改写描述，`stale = true`）；未分析。
 *
 * 前置条件：后端已启动（默认 8080），且配置了可用的 DeepSeek API Key。
 *
 * 用法：
 *   node tools/seed/demo-data.mjs                          # 演示账号 demo/demo1234：4 简历 + 3 岗位，其中 2+2 份做分析
 *   node tools/seed/demo-data.mjs --account xq945 --password 你的密码
 *   node tools/seed/demo-data.mjs --analyses 0 --job-analyses 0   # 只造数据不调模型（不消耗 token）
 *   node tools/seed/demo-data.mjs --analyses 4             # 简历全部做分析
 *   node tools/seed/demo-data.mjs --job-analyses 1         # 岗位只做「已分析」，跳过「过期」的演示数据
 *   node tools/seed/demo-data.mjs --matches 2 --interviews 1      # 再预置 2 条匹配记录与 1 场已完成的面试
 *   node tools/seed/demo-data.mjs --optimizations 1        # 再预置 1 条简历定向优化记录（M11，消耗 2 次模型调用）
 *
 * --matches / --interviews（M9 加入，默认 0 不改变原行为）：为**仪表盘**补上简历/岗位之外的
 * 演示数据——匹配记录、能力差距与面试计数，使准备清单六步接近全亮。匹配用第一份已分析的简历
 * 与第一个未过期的已分析岗位（要求 --analyses ≥ 1 且 --job-analyses ≥ 1）；面试为 1 题会话，
 * 作答至完成（含总分与总评）。
 */
import { buildDocx, buildHtml, buildPdf, buildTxt } from '../e2e/fixtures.mjs'

// ---------------------------------------------------------------- 参数

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const API = argValue('api', 'http://localhost:8080/api')
const ACCOUNT = argValue('account', 'demo')
const PASSWORD = argValue('password', 'demo1234')
const EMAIL = argValue('email', `${ACCOUNT}@example.com`)
/** 前 N 份简历做真实 AI 分析，其余留作「未分析」以便演示发起分析的入口 */
const ANALYSES = Number(argValue('analyses', '2'))

/** 岗位做真实分析的份数（0 = 全部不分析；1 = 仅「已分析」；2 = 再含一份「分析已过期」） */
const JOB_ANALYSES = Number(argValue('job-analyses', '2'))

/** 预置的匹配记录条数（0 = 不预置）——供仪表盘的「最近匹配 / 能力差距概览」有数据 */
const MATCHES = Number(argValue('matches', '0'))

/** 预置的已完成面试场数（0 = 不预置）——供仪表盘的面试计数与准备清单第 6 步 */
const INTERVIEWS = Number(argValue('interviews', '0'))

/** 预置的简历定向优化记录条数（0 = 不预置；M11 加入）——供「简历定向优化」页的演示数据 */
const OPTIMIZATIONS = Number(argValue('optimizations', '0'))

/** 预置面试的回答文本（1 题会话，作答至完成） */
const INTERVIEW_ANSWER = '我会先用 STAR 结构讲清项目背景与我承担的具体职责，再展开技术选型与遇到的难点，'
  + '最后给出可量化的结果与反思。遇到不确定的问题会说明思路边界，而不是硬编一个答案。'

// ---------------------------------------------------------------- 简历素材

const BACKEND_RESUME = `张伟 | 后端开发工程师（应届）
手机：138-0000-0000  邮箱：zhangwei@example.com

【教育背景】
2021.09 - 2025.06  某大学  计算机科学与技术  本科
主修课程：数据结构、操作系统、数据库原理、计算机网络
绩点 3.7/4.0，专业排名前 15%

【专业技能】
- 编程语言：Java（熟练）、SQL、Python（了解）
- 框架：Spring Boot、MyBatis-Plus、Spring Security
- 数据库：MySQL（索引优化、事务）、Redis（缓存）
- 工具：Git、Maven、Docker（基础）、Linux

【项目经历】
校园二手交易平台（2024.03 - 2024.09）
- 担任后端负责人（3 人团队）
- 技术栈：Spring Boot + MyBatis-Plus + MySQL + Redis
- 负责用户模块与订单模块的接口设计与实现，共 30 余个接口
- 使用 Redis 缓存热点商品信息，接口平均响应时间由 120ms 降至 35ms
- 设计订单状态机并支持超时自动取消（Spring Task 定时任务）

【实习经历】
2024.07 - 2024.09  某科技有限公司  后端开发实习生
- 参与内部工单系统迭代开发，独立完成报表导出模块
- 使用 EasyExcel 处理十万级数据导出，内存占用优化约 60%`

const FRONTEND_RESUME = `李娜 | 前端开发工程师（应届）
手机：139-0000-0000  邮箱：lina@example.com

【教育背景】
2021.09 - 2025.06  某大学  软件工程  本科

【专业技能】
- 前端框架：Vue 3（组合式 API）、Pinia、Vue Router、React（了解）
- UI 与样式：Element Plus、Tailwind CSS、HTML5/CSS3
- 工程化：Vite、ESLint、TypeScript、Axios
- 其他：Node.js（基础）、Git

【项目经历】
在线考试系统前端（2024.05 - 2024.11）
- 独立完成学生端全部页面：登录、考试列表、在线答题、成绩查询
- 使用 Vue 3 + Pinia 实现答题状态管理，支持断点续答
- 首屏加载优化：路由懒加载与组件按需引入，产物体积减少约 40%

【校园经历】
校学生会技术部成员，负责活动报名页面的开发与维护`

const INTERN_RESUME = `王强 | 求职意向：Java 后端开发

教育背景：某大学 信息管理与信息系统 本科（2021.09 - 2025.06）

专业技能：Java、Spring Boot、MySQL、Git

项目经历：图书管理系统（课程设计）——实现图书增删改查与借阅记录管理

实习经历：无`

const ENGLISH_RESUME = `Chen Jie - Backend Developer (Fresh Graduate)

Education
2021.09 - 2025.06  Some University  Computer Science  Bachelor

Skills
Java, Spring Boot, MySQL, Redis, Git, Linux

Projects
Campus Second-hand Trading Platform (2024.03 - 2024.09)
- Built user and order modules with Spring Boot and MyBatis-Plus
- Improved hot-data API latency from 120ms to 35ms with Redis caching

Internship
Backend Intern, Some Tech Co., Ltd. (2024.07 - 2024.09)`

/**
 * 依次上传这 4 份简历（覆盖 DOCX / HTML / TXT / PDF 四种格式）；前 ANALYSES 份做真实分析。
 *
 * 注意格式与内容的搭配：**PDF 由 fixtures 的 buildPdf 手写生成，只支持 ASCII**
 * （中文会被丢弃，看起来像简历乱码），故 PDF 承载英文简历，
 * 中文简历一律用 DOCX / HTML / TXT。
 */
const RESUMES = [
  { name: '张伟 - Java后端开发.docx', file: { name: 'zhangwei-backend.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: buildDocx(BACKEND_RESUME.split('\n')) } },
  { name: '李娜 - 前端开发.html', file: { name: 'lina-frontend.html', type: 'text/html', data: buildHtml(FRONTEND_RESUME) } },
  { name: '王强 - 实习简历.txt', file: { name: 'wangqiang-intern.txt', type: 'text/plain', data: buildTxt(INTERN_RESUME) } },
  { name: 'Chen Jie - English Resume.pdf', file: { name: 'chenjie-english.pdf', type: 'application/pdf', data: buildPdf(ENGLISH_RESUME.split('\n')) } },
]

/**
 * 岗位素材：覆盖分析状态的**三态**（演示与答辩用）。
 *
 * - `analyzed`：创建 → 分析（「已分析」）；
 * - `stale`：创建 → 分析 → **改写描述**（「分析已过期」——stale 判定的完整链路）；
 * - `unanalyzed`：仅创建（演示发起分析的入口）。
 */
const JOBS = [
  {
    company: '示例科技',
    name: 'Java 后端开发实习生',
    mode: 'analyzed',
    description: `岗位职责：
1. 参与公司核心业务系统的后端开发，负责接口设计与实现；
2. 配合前端完成联调，参与需求评审与技术方案讨论；
3. 参与系统性能优化与线上问题排查。

任职要求：
1. 本科及以上学历，计算机相关专业，2026 届毕业生；
2. 熟悉 Java 基础，了解集合、多线程、JVM 基础知识；
3. 熟悉 Spring Boot、MyBatis 等主流框架；
4. 熟悉 MySQL，了解索引原理与常见优化手段。

加分项：
1. 了解 Redis、消息队列等中间件；
2. 熟悉 Docker、Linux 常用命令。`,
  },
  {
    company: '云启信息',
    name: '后端开发工程师（校招）',
    mode: 'stale',
    description: `岗位职责：
1. 负责业务中台服务的设计与开发；
2. 参与系统架构演进与技术选型。

任职要求：
1. 熟悉 Java、Spring Boot、MyBatis；
2. 熟悉 MySQL 与 Redis；
3. 有良好的编码习惯与文档意识。`,
    // 分析完成后把描述替换为这段，使已有分析立即变为「已过期」
    updatedDescription: `岗位职责：
1. 负责业务中台服务的设计与开发；
2. 参与系统架构演进与技术选型；
3. 参与技术方案评审与代码评审。

任职要求：
1. 熟悉 Java、Spring Boot、MyBatis；
2. 熟悉 MySQL 与 Redis；
3. 了解消息队列（Kafka/RocketMQ）与容器化部署（Docker/K8s）；
4. 有良好的编码习惯与文档意识。`,
  },
  {
    company: '星野网络',
    name: '全栈开发实习生',
    mode: 'unanalyzed',
    description: `岗位职责：
1. 参与公司运营后台的前后端开发；
2. 在导师指导下完成模块设计与实现。

任职要求：
1. 熟悉 Vue 3 与 Element Plus；
2. 了解 Node.js 或 Java 后端开发；
3. 每周可实习 4 天以上。`,
  },
]

// ---------------------------------------------------------------- API 封装

async function api(path, { token, ...options } = {}) {
  const headers = { ...(options.headers || {}) }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${API}${path}`, { ...options, headers })
  return res.json()
}

async function login() {
  const body = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ACCOUNT, password: PASSWORD }),
  })
  return body.code === 0 ? body.data.token : null
}

async function ensureAccount() {
  let token = await login()
  if (token) {
    return token
  }
  const registered = await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ACCOUNT, email: EMAIL, password: PASSWORD }),
  })
  if (registered.code !== 0) {
    throw new Error(`注册失败：${registered.message}`)
  }
  console.log(`已创建账号 ${ACCOUNT}`)
  token = await login()
  if (!token) {
    throw new Error('注册后登录失败')
  }
  return token
}

/** 清空目标账号的简历（逻辑删除，列表随即变空），保证脚本可重复执行 */
async function clearResumes(token) {
  let removed = 0
  for (let page = 1; page <= 50; page++) {
    const body = await api('/resumes?page=1&size=100', { token })
    const records = body.data?.records || []
    if (records.length === 0) {
      break
    }
    for (const record of records) {
      await api(`/resumes/${record.id}`, { method: 'DELETE', token })
      removed++
    }
  }
  return removed
}

async function upload(token, resume) {
  const form = new FormData()
  form.append('file', new Blob([resume.file.data], { type: resume.file.type }), resume.file.name)
  form.append('name', resume.name)
  const body = await api('/resumes', { method: 'POST', token, body: form })
  if (body.code !== 0) {
    throw new Error(`上传「${resume.name}」失败：${body.message}`)
  }
  return body.data.id
}

async function analyze(token, resumeId) {
  const body = await api(`/resumes/${resumeId}/analyze`, { method: 'POST', token })
  if (body.code !== 0) {
    throw new Error(`分析失败（code=${body.code}）：${body.message}`)
  }
  return body.data
}

// ---------------------------------------------------------------- 岗位数据（M5）

/** 清空目标账号的岗位（逻辑删除，关联分析记录保留在库中） */
async function clearJobs(token) {
  let removed = 0
  for (let page = 1; page <= 50; page++) {
    const body = await api('/jobs?page=1&size=100', { token })
    const records = body.data?.records || []
    if (records.length === 0) {
      break
    }
    for (const record of records) {
      await api(`/jobs/${record.id}`, { method: 'DELETE', token })
      removed++
    }
  }
  return removed
}

async function createJob(token, job) {
  const body = await api('/jobs', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: job.company, jobName: job.name, description: job.description }),
  })
  if (body.code !== 0) {
    throw new Error(`创建岗位「${job.name}」失败：${body.message}`)
  }
  return body.data.id
}

/** 改写岗位描述（全量更新）——用于制造「分析已过期」的演示数据 */
async function updateJobDescription(token, id, job) {
  const body = await api(`/jobs/${id}`, {
    method: 'PUT',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: job.company,
      jobName: job.name,
      description: job.updatedDescription,
    }),
  })
  if (body.code !== 0) {
    throw new Error(`更新岗位「${job.name}」失败：${body.message}`)
  }
  return body.data
}

async function analyzeJob(token, id) {
  const body = await api(`/jobs/${id}/analyze`, { method: 'POST', token })
  if (body.code !== 0) {
    throw new Error(`岗位分析失败（code=${body.code}）：${body.message}`)
  }
  return body.data
}

/** 创建匹配记录（每次调用新增一条，保留历史；要求双方都有未过期的分析） */
async function createMatch(token, resumeId, jobId) {
  const body = await api('/matches', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId, jobId }),
  })
  if (body.code !== 0) {
    throw new Error(`创建匹配失败：${body.message}`)
  }
  return body.data
}

/** 创建简历定向优化（M16 异步任务：创建后轮询至完成；要求双方都有未过期的分析） */
async function createOptimization(token, resumeId, jobId) {
  const body = await api('/optimizations', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId, jobId }),
  })
  if (body.code !== 0) {
    throw new Error(`创建优化失败：${body.message}`)
  }
  // M16：异步化——轮询详情直到任务完成（演示数据需要完整的优化稿与匹配分数）
  const deadline = Date.now() + 240000
  while (Date.now() < deadline) {
    const detail = await api(`/optimizations/${body.data.id}`, { token })
    const status = detail.data?.status
    if (status === 'SUCCESS') {
      return detail.data
    }
    if (status === 'FAILED') {
      throw new Error(`优化任务失败：${detail.data?.errorMessage}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(`优化任务超时未完成：id=${body.data.id}`)
}

/** 创建面试会话（题目随会话一次性生成） */
async function createInterview(token, jobId, title, questionCount) {
  const body = await api('/interviews', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, title, questionType: 'MIXED', questionCount }),
  })
  if (body.code !== 0) {
    throw new Error(`创建面试失败：${body.message}`)
  }
  return body.data
}

/** 提交某题的回答（自动触发评价；最后一题还会生成总分与总评） */
async function answerQuestion(token, sessionId, questionId, answer) {
  const body = await api(`/interviews/${sessionId}/questions/${questionId}/answer`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  })
  if (body.code !== 0) {
    throw new Error(`提交回答失败：${body.message}`)
  }
  return body.data
}

// ---------------------------------------------------------------- 主流程

console.log(`目标后端：${API}`)
console.log(`目标账号：${ACCOUNT}（简历 ${RESUMES.length} 份，前 ${Math.min(ANALYSES, RESUMES.length)} 份分析；`
  + `岗位 ${JOBS.length} 个，前 ${Math.min(JOB_ANALYSES, JOBS.length)} 个做分析）\n`)

let token
try {
  token = await ensureAccount()
}
catch (error) {
  console.error(`❌ ${error.message}（后端未启动？）`)
  process.exit(1)
}

const removed = await clearResumes(token)
if (removed > 0) {
  console.log(`已清理该账号原有简历 ${removed} 份（逻辑删除）`)
}
const removedJobs = await clearJobs(token)
if (removedJobs > 0) {
  console.log(`已清理该账号原有岗位 ${removedJobs} 个（逻辑删除）`)
}

const created = []
for (const [index, resume] of RESUMES.entries()) {
  const id = await upload(token, resume)
  const shouldAnalyze = index < ANALYSES
  let analysisInfo = '未分析'
  if (shouldAnalyze) {
    const started = Date.now()
    const analysis = await analyze(token, id)
    analysisInfo = `已分析 v${analysis.versionNo}（${((Date.now() - started) / 1000).toFixed(1)}s，`
      + `${analysis.skills?.length ?? 0} 技能 / ${analysis.suggestions?.length ?? 0} 建议）`
  }
  created.push({ id, name: resume.name, analysisInfo })
  console.log(`  ✓ id=${id}  ${resume.name}  —— ${analysisInfo}`)
}

// ---------------------------------------------------------------- 岗位（三态）

console.log('\n岗位数据（覆盖三态）：')
const createdJobs = []
let analyzedJobCount = 0
for (const job of JOBS) {
  const id = await createJob(token, job)
  let info = '未分析'
  if (job.mode !== 'unanalyzed' && analyzedJobCount < JOB_ANALYSES) {
    const started = Date.now()
    const analysis = await analyzeJob(token, id)
    analyzedJobCount++
    info = `已分析 v${analysis.versionNo}（${((Date.now() - started) / 1000).toFixed(1)}s，`
      + `${analysis.requiredSkills?.length ?? 0} 必备 / ${analysis.preferredSkills?.length ?? 0} 加分）`
    if (job.mode === 'stale') {
      await updateJobDescription(token, id, job)
      info = `分析已过期（分析基于 v${analysis.versionNo}，随后改写了描述）`
    }
  }
  createdJobs.push({ id, name: job.name, info })
  console.log(`  ✓ id=${id}  ${job.company} · ${job.name}  —— ${info}`)
}

// ---------------------------------------------------------------- 匹配记录（可选，供仪表盘）

/** 第一份「已分析」的简历与第一个「未过期」的已分析岗位（过期岗位的 info 以「分析已过期」开头，不会被选中） */
const analyzedResume = created.find((item) => item.analysisInfo.startsWith('已分析'))
const analyzedJob = createdJobs.find((item) => item.info.startsWith('已分析'))

let matchCount = 0
if (MATCHES > 0) {
  console.log('\n匹配记录（预置）：')
  if (!analyzedResume || !analyzedJob) {
    console.log('  ⚠ 缺少已分析（未过期）的简历或岗位，跳过匹配预置——请保证 --analyses ≥ 1 且 --job-analyses ≥ 1')
  }
  else {
    for (let i = 0; i < MATCHES; i++) {
      const started = Date.now()
      const match = await createMatch(token, analyzedResume.id, analyzedJob.id)
      matchCount++
      console.log(`  ✓ id=${match.id}  「${match.jobName}」×「${match.resumeName}」 —— ${match.matchScore} 分`
        + `（${((Date.now() - started) / 1000).toFixed(1)}s）`)
    }
  }
}

// ---------------------------------------------------------------- 简历定向优化（可选，供优化页演示）

let optimizationCount = 0
if (OPTIMIZATIONS > 0) {
  console.log('\n简历定向优化（预置）：')
  if (!analyzedResume || !analyzedJob) {
    console.log('  ⚠ 缺少已分析（未过期）的简历或岗位，跳过优化预置——请保证 --analyses ≥ 1 且 --job-analyses ≥ 1')
  }
  else {
    for (let i = 0; i < OPTIMIZATIONS; i++) {
      const started = Date.now()
      const optimization = await createOptimization(token, analyzedResume.id, analyzedJob.id)
      optimizationCount++
      console.log(`  ✓ id=${optimization.id}  「${optimization.jobName}」×「${optimization.resumeName}」`
        + ` —— 优化前 ${optimization.matchScore} 分 · ${optimization.changes?.length ?? 0} 处改动`
        + ` · ${optimization.gapQuestions?.length ?? 0} 个待确认问题（${((Date.now() - started) / 1000).toFixed(1)}s）`)
    }
  }
}

// ---------------------------------------------------------------- 模拟面试（可选，供仪表盘）

let interviewCount = 0
if (INTERVIEWS > 0) {
  console.log('\n模拟面试（预置已完成场次）：')
  const jobId = analyzedJob?.id ?? createdJobs[0]?.id
  if (!jobId) {
    console.log('  ⚠ 没有可用的岗位，跳过面试预置')
  }
  else {
    const jobName = createdJobs.find((item) => item.id === jobId)?.name ?? '岗位'
    for (let i = 0; i < INTERVIEWS; i++) {
      const started = Date.now()
      const session = await createInterview(token, jobId, `${jobName}模拟面试`, 1)
      await answerQuestion(token, session.id, session.questions[0].id, INTERVIEW_ANSWER)
      interviewCount++
      console.log(`  ✓ id=${session.id}  1 题已作答完成（含总分与总评，${((Date.now() - started) / 1000).toFixed(1)}s）`)
    }
  }
}

console.log(`\n完成：${created.length} 份简历（${Math.min(ANALYSES, RESUMES.length)} 份已分析）`
  + ` + ${createdJobs.length} 个岗位（覆盖未分析 / 已分析 / 分析已过期三态）`
  + ` + ${matchCount} 条匹配记录 + ${optimizationCount} 条优化记录 + ${interviewCount} 场已完成面试。`)
console.log(`登录演示账号：${ACCOUNT} / ${PASSWORD}`)
