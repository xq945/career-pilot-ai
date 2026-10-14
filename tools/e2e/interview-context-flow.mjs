/**
 * M12 面试接入工作流端到端验证（真实浏览器 + 真实模型调用）。
 *
 * 覆盖《开发顺序》M12 的验收标准与《前端原型设计》§5.8 / §5.9 / §5.10 的页面行为：
 * 优化工作台「用这份简历模拟面试」→ 跳转面试列表并**自动打开新建弹窗（来源锁定态）**、
 * 提交出题（携带 optimizationId）→ 答题页头部来源展示、列表项来源展示、
 * 普通新建态的「关联简历（可选）」下拉。
 *
 * 接口层（一致性校验、越权矩阵、装配三规则契约）由 tools/verify/m12-interview-context-api.mjs 验证，
 * 本脚本只补浏览器独有的部分。
 *
 * **本脚本会消耗真实模型 token（预置分析 2 次 + 创建优化 2 次 + 出题 1 次 = 5 次调用）。**
 *
 * 前置条件：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/interview-context-flow.mjs
 *   node tools/e2e/interview-context-flow.mjs --shots ./tmp/shots-m12
 */
import { closeBrowser, connect, createChecker, launchBrowser, sleep } from './cdp.mjs'

// ---------------------------------------------------------------- 参数

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = argValue('base', 'http://localhost:5173')
const API = argValue('api', 'http://localhost:8080/api')
const PORT = Number(argValue('port', '9226'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_m12_${STAMP}`
const PASS = 'Test1234'

/** 真实模型调用的等待上限（创建优化 25–80 秒；出题 10–40 秒） */
const AI_TIMEOUT = 300000

const { check, summary } = createChecker()

const JOB_NAME = 'Java 后端开发实习生'
const RESUME_NAME = 'M12 面试来源简历'

const DESC = `岗位职责：
1. 参与核心业务系统的后端开发，负责接口设计与实现；
2. 配合前端完成联调。

任职要求：
1. 熟悉 Java 与 Spring Boot；
2. 熟悉 MySQL；
3. 有 Docker 使用经验者优先。`

const RESUME_TEXT = `张三 / Java 后端开发
技能：Java、Spring Boot、MySQL、Redis
项目经历：校园二手交易平台（后端负责人，2024.03-2024.09），使用 Java 与 Spring Boot 实现订单模块，MySQL 存储数据
工作/实习：示例科技 后端实习生（2024.07-2025.06）
教育经历：示例大学 计算机科学与技术 本科（2021-2025）`

// ---------------------------------------------------------------- 接口辅助

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  let payload
  if (form) {
    payload = form
  }
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(API + path, { method, headers, body: payload })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

async function uploadResume(token, name) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
  return (await api('POST', '/resumes', { token, form })).body?.data?.id
}

// ---------------------------------------------------------------- 主流程

console.log(`前置检查：后端 ${API} / 前端 ${BASE}\n`)

const register = await api('POST', '/auth/register', {
  body: { username: USER, email: `${USER}@example.com`, password: PASS },
})
if (register.body?.code !== 0) {
  console.error(`❌ 无法创建测试账号（后端未启动？）：${register.body?.message || JSON.stringify(register.body)}`)
  process.exit(1)
}
const login = await api('POST', '/auth/login', { body: { account: USER, password: PASS } })
const TOKEN = login.body?.data?.token
if (!TOKEN) {
  console.error('❌ 登录失败')
  process.exit(1)
}

const jobId = (await api('POST', '/jobs', {
  token: TOKEN,
  body: { jobName: JOB_NAME, companyName: '示例科技', description: DESC },
})).body?.data?.id
const resumeId = await uploadResume(TOKEN, RESUME_NAME)
const jobAnalysis = await api('POST', `/jobs/${jobId}/analyze`, { token: TOKEN })
const resumeAnalysis = await api('POST', `/resumes/${resumeId}/analyze`, { token: TOKEN })
if (jobAnalysis.body?.code !== 0 || resumeAnalysis.body?.code !== 0) {
  console.error('❌ 预置分析失败，无法继续')
  process.exit(1)
}

console.log('已预置：1 个已分析岗位 + 1 份已分析简历，创建定向优化（25–80 秒）…')
const optimization = await api('POST', '/optimizations', {
  token: TOKEN,
  body: { resumeId, jobId },
})
const optimizationId = optimization.body?.data?.id
if (!optimizationId) {
  console.error(`❌ 创建优化失败：${optimization.body?.message}`)
  process.exit(1)
}
console.log(`优化记录 #${optimizationId} 就绪（账号 ${USER}）\n`)

// ---------------------------------------------------------------- 启动浏览器

const browser = await launchBrowser({ port: PORT })
const page = await connect({ port: PORT })
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})

const shot = async (name) => {
  if (SHOTS) {
    await sleep(250)
    await page.screenshot(`${SHOTS}/${name}.png`)
  }
}

/** 按精确文本点击按钮（抛错而非静默失败） */
const clickByText = (text, scope = 'button') => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll(${JSON.stringify(scope)})]
    .find((el) => el.textContent.trim() === ${JSON.stringify(text)})
  if (!btn) throw new Error('找不到按钮：' + ${JSON.stringify(text)})
  btn.click()
  return true
})()`)

try {
  /* ============================================================== ① 登录与工作台 */

  console.log('== ① 登录 → 优化工作台渲染 ==')
  await page.goto(`${BASE}/optimizations/${optimizationId}`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向到登录页', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/optimizations/${optimizationId}'`,
    { label: '登录后回跳优化工作台', timeout: 20000 })
  await page.waitFor(`document.body.innerText.includes('用这份简历模拟面试')`,
    { label: '工作台「下一步」卡渲染', timeout: 20000 })
  check('① 登录后回跳优化工作台，「下一步」入口可见', true)
  await shot('01-workbench')

  /* ============================================================== ② 跳转与来源锁定态 */

  console.log('\n== ② 「用这份简历模拟面试」→ 跳转面试列表并自动打开弹窗 ==')
  await clickByText('用这份简历模拟面试')
  await page.waitFor(
    `location.pathname === '/interviews' && location.search.includes('optimizationId')`,
    { label: '跳转到面试列表并携带 optimizationId', timeout: 20000 },
  )
  await page.waitFor(`document.querySelector('.el-dialog') !== null`,
    { label: '新建弹窗自动打开', timeout: 20000 })
  await page.waitFor(`!!document.querySelector('.el-dialog .source')`,
    { label: '来源徽标渲染', timeout: 15000 })

  const sourceText = await page.textOf('.el-dialog .source')
  check('② 弹窗展示来源徽标（优化稿 v{N} · 简历名 · 岗位名）',
    sourceText.includes('优化稿 v') && sourceText.includes(RESUME_NAME) && sourceText.includes(JOB_NAME),
    sourceText)

  const dialogText = await page.textOf('.el-dialog')
  check('② 来源锁定态：岗位下拉被来源徽标替代（无「选择岗位」项）',
    !dialogText.includes('选择岗位'), dialogText.slice(0, 160))
  check('② 来源锁定态隐藏「关联简历」选择器（来源已由优化记录锁定）',
    !dialogText.includes('关联简历'), dialogText.slice(0, 160))
  await shot('02-dialog-source')

  /* ============================================================== ③ 出题 */

  console.log('\n== ③ 提交出题（真实模型，10–40 秒）→ 跳转答题页 ==')
  await clickByText('生成题目', '.el-dialog__footer .el-button')
  await page.waitFor(`document.body.innerText.includes('AI 正在生成面试题')`,
    { label: '出题等待态', timeout: 15000 })
  await shot('03-generating')
  await page.waitFor(`/^\\/interviews\\/\\d+$/.test(location.pathname)`,
    { label: '出题完成并跳转答题页', timeout: AI_TIMEOUT })
  const sessionId = Number((await page.evaluate('location.pathname')).split('/').pop())
  check('③ 出题成功并跳转答题页', Number.isInteger(sessionId) && sessionId > 0)

  const detail = (await api('GET', `/interviews/${sessionId}`, { token: TOKEN })).body?.data
  check('③ 会话来源落库：resumeId 由优化推导、optimizationId 为所选优化',
    detail?.resumeId === resumeId && detail?.optimizationId === optimizationId,
    JSON.stringify({ resumeId: detail?.resumeId, optimizationId: detail?.optimizationId }))

  /* ============================================================== ④ 答题页来源 */

  console.log('\n== ④ 答题页头部来源展示 ==')
  await page.waitFor(`!!document.querySelector('.page-head__source')`,
    { label: '答题页头部来源行', timeout: 15000 })
  const sessionSource = await page.textOf('.page-head__source')
  check('④ 答题页显示「来源：优化稿 v{N} · 简历名」',
    sessionSource.includes('来源：优化稿 v') && sessionSource.includes(RESUME_NAME), sessionSource)
  await shot('04-session')

  /* ============================================================== ⑤ 列表来源 */

  console.log('\n== ⑤ 面试列表项来源展示 ==')
  await page.goto(`${BASE}/interviews`)
  await page.waitFor(`document.querySelectorAll('.item').length >= 1`,
    { label: '列表渲染', timeout: 20000 })
  const listMeta = await page.textOf('.item__meta')
  check('⑤ 列表项显示来源（优化稿 v{N} · 简历名）',
    listMeta.includes('来源：优化稿 v') && listMeta.includes(RESUME_NAME), listMeta)
  await shot('05-list')

  /* ============================================================== ⑥ 普通新建态 */

  console.log('\n== ⑥ 普通新建弹窗：「关联简历（可选）」 ==')
  await clickByText('新建模拟面试', '.page-head .el-button')
  await page.waitFor(`document.querySelector('.el-dialog') !== null`, { label: '弹窗打开', timeout: 15000 })
  await page.waitFor(`document.body.innerText.includes('关联简历（可选）')`,
    { label: '关联简历表单项', timeout: 15000 })
  const normalDialog = await page.textOf('.el-dialog')
  check('⑥ 普通新建态：岗位下拉与「关联简历（可选）」均在，无来源徽标',
    normalDialog.includes('选择岗位') && normalDialog.includes('关联简历（可选）')
      && !normalDialog.includes('优化稿 v'), normalDialog.slice(0, 200))
  await shot('06-normal-dialog')
  await clickByText('取消', '.el-dialog__footer .el-button')
}
catch (error) {
  check(`脚本执行未抛异常（${error.message}）`, false)
  console.error(error)
}
finally {
  console.log(`\n（提示）测试数据可手工清理：DELETE FROM sys_user WHERE username = '${USER}';`)
  const ok = summary()
  await closeBrowser(PORT, browser)
  process.exit(ok ? 0 : 1)
}
