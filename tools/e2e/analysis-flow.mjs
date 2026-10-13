/**
 * 简历 AI 分析端到端验证（真实浏览器 + 真实模型调用）。
 *
 * 覆盖《开发顺序》M4 的前端验收与《前端原型设计》§5.4／§4.3 对应的页面行为：
 * 列表页分析入口（发起 / 重新分析 / 查看分析）、确认弹窗、AiWaiting 等待态、
 * 结果渲染（概述 / 技能卡 / 优势 / 待改进 / 建议 / 分析信息）、
 * 重新分析路径（内容未变 → 重新生成新版本）、未分析空态、错误态。
 *
 * 接口层的版本递增证据、50200/50201 与越权矩阵由 curl 验证（见《验证记录》§5.1），
 * 本脚本只补浏览器独有的部分。**本脚本会消耗真实模型 token（一次完整分析）**。
 *
 * 前置条件：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/analysis-flow.mjs
 *   node tools/e2e/analysis-flow.mjs --shots ./shots
 */
import { closeBrowser, connect, createChecker, launchBrowser } from './cdp.mjs'
import { buildTxt } from './fixtures.mjs'

// ---------------------------------------------------------------- 参数

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = argValue('base', 'http://localhost:5173')
const API = argValue('api', 'http://localhost:8080/api')
const PORT = Number(argValue('port', '9222'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_analysis_${STAMP}`
const PASS = 'Test1234'

/** 真实模型调用的等待上限（通常 10–30 秒，留足重试余量） */
const ANALYSIS_TIMEOUT = 120000

const { check, summary } = createChecker()

const SAMPLE = '张三，计算机科学与技术专业本科应届生，熟悉 Java、Spring Boot、MySQL，'
  + '参与过校园二手交易平台的后端开发，负责用户模块与订单模块的接口设计与实现。'

const TXT_FILE = { name: 'analysis-resume.txt', type: 'text/plain', data: buildTxt(SAMPLE) }
const TXT_FILE_2 = { name: 'analysis-resume-2.txt', type: 'text/plain', data: buildTxt(SAMPLE + ' 另有 Git 使用经验。') }

// ---------------------------------------------------------------- 准备测试账号

console.log(`前置检查：后端 ${API} / 前端 ${BASE}\n`)

const seed = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, email: `${USER}@example.com`, password: PASS }),
}).then((r) => r.json()).catch((error) => ({ message: error.message }))

if (seed.code !== 0) {
  console.error(`❌ 无法创建测试账号（后端未启动？）：${seed.message || JSON.stringify(seed)}`)
  process.exit(1)
}
console.log(`已创建测试账号 ${USER}\n`)

// ---------------------------------------------------------------- 启动浏览器

const browser = await launchBrowser({ port: PORT })
const page = await connect({ port: PORT })
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})

const shot = async (name) => {
  if (SHOTS) {
    await page.screenshot(`${SHOTS}/${name}.png`)
  }
}

/** 把 Node 侧构造的文件按字节注入 el-upload 的隐藏 input（base64 传输） */
async function injectFile(file) {
  const base64 = file.data.toString('base64')
  await page.evaluate(`(() => {
    const input = document.querySelector('.el-upload input[type=file]')
    if (!input) throw new Error('file input 不存在')
    const bin = atob('${base64}')
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], '${file.name}', { type: '${file.type}' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

/** ElMessageBox 是否可见（它是动态插入 DOM 的，关闭即移除；仍用 offsetParent 双保险） */
const MESSAGE_BOX_VISIBLE = `(() => {
  const el = document.querySelector('.el-message-box')
  return !!el && el.offsetParent !== null
})()`

const messageBoxText = () => page.evaluate(
  `(() => {
     const el = document.querySelector('.el-message-box')
     return el ? el.innerText : ''
   })()`)

/** 点击确认弹窗的主按钮（「开始分析」/「确定」） */
const clickMessageBoxConfirm = () => page.evaluate(`(() => {
  const btn = document.querySelector('.el-message-box__btns .el-button--primary')
  if (!btn) throw new Error('找不到确认按钮')
  btn.click()
  return true
})()`)

/** 等待列表页渲染完成 */
const waitResumesReady = () => page.waitFor(
  `document.querySelector('.page-head h1')?.textContent?.trim() === '简历管理'`,
  { label: '简历页渲染完成', timeout: 20000 })

/** 等待分析页渲染完成（页头出现简历名或占位标题） */
const waitAnalysisReady = () => page.waitFor(
  `document.querySelector('.page-head h1')?.textContent?.trim() !== ''`,
  { label: '分析页渲染完成', timeout: 20000 })

/** 点击列表行内按钮（按文案定位第一处匹配） */
async function clickItemButton(text) {
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.item .el-button')]
      .find((el) => el.textContent.trim() === '${text}')
    if (!btn) throw new Error('找不到列表按钮：${text}')
    btn.click()
    return true
  })()`)
}

/** 点击页内按钮（非列表、非弹窗，如右侧栏的「重新分析」） */
async function clickPageButton(text) {
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-button')]
      .find((el) => el.textContent.trim() === '${text}' && el.offsetParent !== null)
    if (!btn) throw new Error('找不到按钮：${text}')
    btn.click()
    return true
  })()`)
}

/** 上传一份 TXT 简历（列表页 → 弹窗 → 提交），返回后列表新增第 expectedCount 项 */
async function uploadResume(file, expectedCount) {
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.page-head .el-button')]
      .find((el) => el.textContent.includes('上传简历'))
    if (!btn) throw new Error('找不到上传按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(
    `(() => { const el = document.querySelector('.el-dialog .el-upload-dragger'); return !!el && el.offsetParent !== null })()`,
    { label: '上传弹窗打开' })
  await injectFile(file)
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
      .find((el) => el.textContent.trim() === '开始上传')
    if (!btn) throw new Error('找不到开始上传按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(
    `document.querySelectorAll('.item').length === ${expectedCount}`,
    { label: `列表变为 ${expectedCount} 项`, timeout: 30000 })
}

try {
  // ------------------------------------------------------------ ① 登录并上传简历

  // 先访问受保护页触发守卫重定向（登录后带 redirect 回跳 /resumes）；
  // 直接访问 /login 登录后只会跳默认的 /dashboard
  await page.goto(`${BASE}/resumes`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/resumes`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向到登录页', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/resumes'`, { label: '登录后回跳简历页', timeout: 20000 })
  await waitResumesReady()

  await uploadResume(TXT_FILE, 1)
  await page.waitFor(`document.querySelector('.item .el-tag')?.textContent?.trim() === '未分析'`,
    { label: '新简历标签为未分析', timeout: 15000 })
  check('① 上传后列表显示「未分析」标签', (await page.textOf('.item .el-tag')).trim() === '未分析')

  const rowButtons = await page.evaluate(
    `[...document.querySelectorAll('.item .el-button')].map((el) => el.textContent.trim())`)
  check('   未分析行只有「发起分析」与「删除」（无「查看分析」）',
    rowButtons.includes('发起分析') && rowButtons.includes('删除') && !rowButtons.includes('查看分析'),
    rowButtons.join('/'))
  await shot('01-list-unanalyzed')

  // ------------------------------------------------------------ ② 发起分析（跳转 + 确认）

  await clickItemButton('发起分析')
  await page.waitFor(`/^\\/resumes\\/\\d+\\/analysis$/.test(location.pathname)`,
    { label: '跳转分析页', timeout: 15000 })
  check('② 点击「发起分析」跳转到 /resumes/{id}/analysis?auto=1',
    (await page.currentPath()).includes('auto=1'), await page.currentPath())

  await page.waitFor(MESSAGE_BOX_VISIBLE, { label: '自动弹出确认框', timeout: 15000 })
  const confirmText = await messageBoxText()
  check('③ 进入后自动弹出确认框且说明耗时',
    confirmText.includes('发起 AI 分析') && confirmText.includes('10–30 秒'),
    confirmText.replace(/\s+/g, ' ').slice(0, 80))
  await shot('02-confirm-dialog')

  // ------------------------------------------------------------ ③ 等待态

  await clickMessageBoxConfirm()
  await page.waitFor(`!!document.querySelector('.ai-waiting')`, { label: '等待态出现', timeout: 10000 })
  const waitingText = await page.textOf('.ai-waiting')
  check('④ 确认后出现 AiWaiting 等待态（spinner + 预计耗时 + 可离开提示）',
    waitingText.includes('AI 正在阅读你的简历')
      && waitingText.includes('10–30 秒')
      && waitingText.includes('可以离开本页'),
    waitingText.replace(/\s+/g, ' ').slice(0, 60))
  // el-tag 切换带 0.3 秒过渡动画：动画期间新旧标签同时在 DOM 中，
  // 因此用「集合包含」判定，而不是取第一个标签的文本
  const headTagsDuring = await page.evaluate(
    `[...document.querySelectorAll('.page-head .el-tag')].map((e) => e.textContent.trim())`)
  check('   等待期间页头标签为「分析中」',
    headTagsDuring.includes('分析中'), headTagsDuring.join('/'))
  await shot('03-ai-waiting')

  // ------------------------------------------------------------ ④ 结果渲染（真实模型调用）

  console.log(`   等待真实模型分析完成（最长 ${ANALYSIS_TIMEOUT / 1000} 秒）…`)
  await page.waitFor(`!!document.querySelector('.summary')`,
    { label: '分析结果渲染', timeout: ANALYSIS_TIMEOUT })
  await page.waitFor(`!document.querySelector('.ai-waiting')`, { label: '等待态消失', timeout: 10000 })

  const summaryText = await page.textOf('.summary')
  const skillCount = await page.evaluate(`document.querySelectorAll('.skill-tag').length`)
  const skillLevelTags = await page.evaluate(
    `document.querySelectorAll('.skill-tag .el-tag').length`)
  const advantageCount = await page.evaluate(`document.querySelectorAll('.bullets--ok li').length`)
  const weaknessCount = await page.evaluate(`document.querySelectorAll('.bullets--warn li').length`)
  const suggestionCount = await page.evaluate(`document.querySelectorAll('.suggestions li').length`)

  check('⑤ 结果渲染：概述非空（中文无乱码）',
    summaryText.trim().length > 10, `${summaryText.trim().length} 字`)
  check('   技能卡 ≥ 1 且每项带掌握程度标签',
    skillCount >= 1 && skillLevelTags >= skillCount, `${skillCount} 项 / ${skillLevelTags} 个标签`)
  check('   优势 ≥ 1、待改进 ≥ 1、改进建议 ≥ 1',
    advantageCount >= 1 && weaknessCount >= 1 && suggestionCount >= 1,
    `${advantageCount}/${weaknessCount}/${suggestionCount}`)

  const sideText = await page.textOf('.layout__side')
  check('   分析信息含版本 v1、模型名与时间',
    sideText.includes('v1') && sideText.includes('deepseek') && sideText.includes('分析时间'),
    sideText.replace(/\s+/g, ' ').slice(0, 70))
  const headTagsAfter = await page.evaluate(
    `[...document.querySelectorAll('.page-head .el-tag')].map((e) => e.textContent.trim())`)
  check('   页头标签变为「已分析」',
    headTagsAfter.includes('已分析'), headTagsAfter.join('/'))
  await shot('04-analysis-result')

  // ------------------------------------------------------------ ⑤ 重新分析（内容未变 → 重新生成）

  await clickPageButton('重新分析')
  await page.waitFor(MESSAGE_BOX_VISIBLE, { label: '重新分析确认框', timeout: 10000 })
  await clickMessageBoxConfirm()
  await page.waitFor(`!!document.querySelector('.ai-waiting')`, { label: '等待态出现', timeout: 10000 })
  console.log(`   等待真实模型重新分析（最长 ${ANALYSIS_TIMEOUT / 1000} 秒）…`)
  await page.waitFor(`!document.querySelector('.ai-waiting')`, { label: '重新分析完成', timeout: ANALYSIS_TIMEOUT })
  const sideTextAfter = await page.textOf('.layout__side')
  check('⑥ 重新分析（内容未变）生成新版本 v2（不再复用）',
    sideTextAfter.includes('v2'), sideTextAfter.replace(/\s+/g, ' ').slice(0, 70))

  // ------------------------------------------------------------ ⑥ 返回列表（联动）

  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.page-head .el-button')]
      .find((el) => el.textContent.includes('返回简历列表'))
    if (!btn) throw new Error('找不到返回按钮')
    btn.click()
    return true
  })()`)
  await waitResumesReady()
  await page.waitFor(`document.querySelector('.item .el-tag')?.textContent?.trim() === '已分析'`,
    { label: '列表标签变为已分析', timeout: 15000 })
  const rowButtonsAfter = await page.evaluate(
    `[...document.querySelectorAll('.item .el-button')].map((el) => el.textContent.trim())`)
  check('⑦ 返回列表：标签「已分析」且出现「查看分析」「重新分析」',
    rowButtonsAfter.includes('查看分析') && rowButtonsAfter.includes('重新分析'),
    rowButtonsAfter.join('/'))
  await shot('05-list-analyzed')

  // ------------------------------------------------------------ ⑦ 查看分析（不自动发起）

  await clickItemButton('查看分析')
  await page.waitFor(`/^\\/resumes\\/\\d+\\/analysis$/.test(location.pathname)`,
    { label: '跳转分析页', timeout: 15000 })
  await page.waitFor(`!!document.querySelector('.summary')`, { label: '直接渲染结果', timeout: 20000 })
  check('⑧「查看分析」不自动发起（无确认框）且直接展示结果',
    !(await page.evaluate(MESSAGE_BOX_VISIBLE)) && !(await page.currentPath()).includes('auto=1'))

  // ------------------------------------------------------------ ⑧ 未分析空态（第二份简历）

  await page.evaluate('location.href = "/resumes"')
  await waitResumesReady()
  await uploadResume(TXT_FILE_2, 2)
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.item .el-button')]
      .find((el) => el.textContent.trim() === '发起分析')
    if (!btn) throw new Error('找不到发起分析按钮')
    // 只点按钮的兄弟节点：先找出未分析行
    const row = [...document.querySelectorAll('.item')]
      .find((el) => el.querySelector('.el-tag')?.textContent?.trim() === '未分析')
    if (!row) throw new Error('找不到未分析行')
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '发起分析').click()
    return true
  })()`)
  await page.waitFor(`/^\\/resumes\\/\\d+\\/analysis/.test(location.pathname)`,
    { label: '进入第二份简历分析页', timeout: 15000 })
  await page.waitFor(MESSAGE_BOX_VISIBLE, { label: '确认框出现', timeout: 15000 })
  // 取消：验证取消后停留在未分析空态
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-message-box__btns .el-button')]
      .find((el) => el.textContent.trim() === '取消')
    if (!btn) throw new Error('找不到取消按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(`!(${MESSAGE_BOX_VISIBLE})`, { label: '取消后弹窗关闭', timeout: 10000 })
  const emptyText = await page.textOf('.empty')
  check('⑨ 取消后停留在未分析空态（有「发起 AI 分析」入口）',
    emptyText.includes('还没有做过 AI 分析') && emptyText.includes('简历定向优化的前置条件'),
    emptyText.replace(/\s+/g, ' ').slice(0, 60))
  await shot('06-unanalyzed-empty')

  // ------------------------------------------------------------ ⑨ 错误态（不存在的简历）

  await page.goto(`${BASE}/resumes/999999999/analysis`)
  await waitAnalysisReady()
  await page.waitFor(`!!document.querySelector('.state')`, { label: '错误态出现', timeout: 20000 })
  const errorText = await page.textOf('.state')
  check('⑩ 不存在的简历 ID：页面显示错误态与重试按钮',
    errorText.includes('加载失败') && errorText.includes('简历不存在'),
    errorText.replace(/\s+/g, ' ').slice(0, 60))
  check('   错误态有「重试」按钮',
    (await page.evaluate(`[...document.querySelectorAll('.state .el-button')].map((el) => el.textContent.trim())`))
      .includes('重试'))
  await shot('07-error-state')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

const userId = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: USER, password: PASS }),
}).then((r) => r.json()).then((b) => b.data?.user?.id).catch(() => null)

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  -- 数据库（先删分析再看情况删简历与账号）：`)
console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id = ${userId ?? '<uid>'});`)
console.log(`  DELETE FROM resume WHERE user_id = ${userId ?? '<uid>'};`)
console.log(`  DELETE FROM sys_user WHERE id = ${userId ?? '<uid>'};`)
console.log(`  -- 物理文件目录（${userId ?? '<uid>'} 为该用户的子目录）：`)
console.log(`  ~/career-pilot-uploads/${userId ?? '<uid>'}/`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
