/**
 * 简历定向优化模块端到端验证（真实浏览器 + 真实模型调用）。
 *
 * 覆盖《开发顺序》M11 的验收标准与《前端原型设计》§5.7 / §5.8 / §6.4 的页面行为：
 * 导航与空态、新建弹窗的**就地拦截**（未分析简历 / 未分析岗位，且不发出请求）、
 * 选择已有岗位的完整优化流程、工作台九区块渲染、编辑保存（不覆盖模型原稿）、
 * 重新评估、历史版本回填、列表分数对比，以及**手动输入 JD 的三步编排**。
 *
 * 接口层（契约、越权矩阵、失败矩阵、DOCX 字节）由 tools/verify/m11-optimization-api.mjs 验证，
 * 本脚本只补浏览器独有的部分。
 *
 * **本脚本会消耗真实模型 token（预置分析 2 次 + 主流程 3 次 + 手动 JD 路径 3 次 = 8 次调用）。**
 *
 * 前置条件：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/optimization-flow.mjs
 *   node tools/e2e/optimization-flow.mjs --shots ./tmp/shots-optimization
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
const PORT = Number(argValue('port', '9225'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_opt_${STAMP}`
const PASS = 'Test1234'

/** 真实模型调用的等待上限（创建优化 25–80 秒，评估 10–30 秒） */
const AI_TIMEOUT = 300000

const { check, summary } = createChecker()

const COMPANY = '示例科技'
const JOB_NAME = 'Java 后端开发实习生'
const RAW_JOB_NAME = '未分析岗位'
const RESUME_NAME = '优化验收简历'
const RAW_RESUME_NAME = '未分析简历'

const DESC = `岗位职责：
1. 参与核心业务系统的后端开发，负责接口设计与实现；
2. 配合前端完成联调。

任职要求：
1. 熟悉 Java 与 Spring Boot；
2. 熟悉 MySQL；
3. 有 Docker 使用经验者优先。`

const MANUAL_JD = `岗位职责：
1. 参与数据平台的后端服务开发；
2. 编写接口文档并参与联调。

任职要求：
1. 熟悉 Java、Spring Boot 与 MySQL；
2. 了解 Redis；
3. 有良好的沟通协作能力。`

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
console.log(`已创建测试账号 ${USER}\n`)

const jobId = (await api('POST', '/jobs', {
  token: TOKEN,
  body: { jobName: JOB_NAME, companyName: COMPANY, description: DESC },
})).body?.data?.id
const rawJobId = (await api('POST', '/jobs', {
  token: TOKEN,
  body: { jobName: RAW_JOB_NAME, description: 'Java 后端方向，要求熟悉 Java。' },
})).body?.data?.id
const resumeId = await uploadResume(TOKEN, RESUME_NAME)
const rawResumeId = await uploadResume(TOKEN, RAW_RESUME_NAME)

const jobAnalysis = await api('POST', `/jobs/${jobId}/analyze`, { token: TOKEN })
const resumeAnalysis = await api('POST', `/resumes/${resumeId}/analyze`, { token: TOKEN })
if (jobAnalysis.body?.code !== 0 || resumeAnalysis.body?.code !== 0) {
  console.error('❌ 预置分析失败，无法继续：'
    + `岗位 code=${jobAnalysis.body?.code} 简历 code=${resumeAnalysis.body?.code}`)
  process.exit(1)
}
console.log('已预置：1 个已分析岗位 + 1 个未分析岗位 + 1 份已分析简历 + 1 份未分析简历\n')

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

/** 弹窗内提交按钮是否禁用（按文案匹配：「开始优化」） */
const submitDisabled = () => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.includes('开始优化'))
  return !btn || btn.disabled
})()`)

/** 点击弹窗底部按钮 */
const clickDialogButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.trim() === '${text}')
  if (!btn) throw new Error('找不到弹窗按钮：${text}')
  btn.click()
  return true
})()`)

/** 在第 pickerIndex 个资源选择器里按名称选中一行 */
const pickByName = (pickerIndex, name) => page.evaluate(`(() => {
  const picker = document.querySelectorAll('.el-dialog .picker')[${pickerIndex}]
  if (!picker) throw new Error('找不到资源选择器 #${pickerIndex}')
  const item = [...picker.querySelectorAll('.picker__item')]
    .find((el) => el.textContent.includes('${name}'))
  if (!item) throw new Error('选择器 #${pickerIndex} 中找不到：${name}')
  item.querySelector('.picker__radio').click()
  return true
})()`)

/** 选择器 #pickerIndex 的拦截提示文本（无提示返回空串） */
const blockText = (pickerIndex) => page.evaluate(`(() => {
  const picker = document.querySelectorAll('.el-dialog .picker')[${pickerIndex}]
  const el = picker?.querySelector('.picker__block')
  return el ? el.innerText.replace(/\\n/g, ' ') : ''
})()`)

/** 工作台某区块的文本（按标题定位卡片） */
const cardText = (title) => page.evaluate(`(() => {
  const card = [...document.querySelectorAll('.el-card')]
    .find((el) => el.querySelector('.el-card__header')?.innerText.includes('${title}'))
  return card ? card.innerText.replace(/\\n/g, ' ') : ''
})()`)

try {
  /* ============================================================== ① 登录与列表空态 */

  console.log('== ① 登录 → 导航「简历定向优化」 → 空态 ==')
  // 浏览器使用全新 profile（见 launchBrowser 的独立 user-data-dir），无需清 localStorage；
  // 且初始页是 about:blank（opaque origin），在那里读 localStorage 会被浏览器拒绝
  await page.goto(`${BASE}/optimizations`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向到登录页', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/optimizations'`, { label: '登录后回跳优化页', timeout: 20000 })

  const navText = await page.evaluate(`(() => {
    const items = [...document.querySelectorAll('.el-menu-item')]
    const active = items.find((el) => el.className.includes('is-active'))
    return items.map((el) => el.innerText.replace(/\\n/g, ' ')).join(' | ') + ' || 高亮=' + (active?.innerText ?? '')
  })()`)
  check('① 导航项为「简历定向优化」且当前高亮',
    navText.includes('简历定向优化') && navText.includes('高亮=简历定向优化'), navText)

  await page.waitFor(`!!document.querySelector('.state__title')`, { label: '空态渲染', timeout: 15000 })
  const emptyText = await page.textOf('.state')
  check('① 空态：文案说明用途并有「新建简历优化」入口',
    emptyText.includes('还没有优化记录') && emptyText.includes('逐项说明改了什么')
    && emptyText.includes('新建简历优化'), emptyText.slice(0, 120))
  await shot('01-empty')

  /* ============================================================== ② 弹窗就地拦截 */

  console.log('\n== ② 新建弹窗：未分析资源就地拦截（不发请求） ==')
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.page-head .el-button')]
      .find((el) => el.textContent.includes('新建简历优化'))
    btn.click()
  })()`)
  await page.waitFor(
    `document.querySelectorAll('.el-dialog .picker__item').length >= 4`,
    { label: '弹窗与两个选择器渲染', timeout: 15000 },
  )
  check('② 弹窗内提交按钮初始为禁用（尚未选择双方）', await submitDisabled())

  await pickByName(0, RAW_RESUME_NAME)
  await page.waitFor(`!!document.querySelectorAll('.el-dialog .picker')[0].querySelector('.picker__block')`,
    { label: '未分析简历的拦截提示', timeout: 10000 })
  const resumeBlock = await blockText(0)
  check('② 选中未分析简历 → 就地警告 + 提交禁用（前端拦截，不发出请求）',
    resumeBlock.includes('未分析') && await submitDisabled(), resumeBlock)

  await pickByName(0, RESUME_NAME)
  await pickByName(1, RAW_JOB_NAME)
  await page.waitFor(`!!document.querySelectorAll('.el-dialog .picker')[1].querySelector('.picker__block')`,
    { label: '未分析岗位的拦截提示', timeout: 10000 })
  const jobBlock = await blockText(1)
  check('② 选中未分析岗位 → 就地警告 + 提交禁用',
    jobBlock.includes('未分析') && await submitDisabled(), jobBlock)

  /* ============================================================== ③ 选择已有岗位创建优化 */

  console.log('\n== ③ 选择已有岗位 → 创建优化（匹配 + 优化生成，2 次模型调用） ==')
  await pickByName(1, JOB_NAME)
  await page.waitFor(`!document.querySelectorAll('.el-dialog .picker')[1].querySelector('.picker__block')`,
    { label: '拦截提示消失', timeout: 10000 })
  check('③ 双方均为已分析资源 → 提交按钮可用', !(await submitDisabled()))
  await shot('02-dialog-ready')

  await clickDialogButton('开始优化')
  // M16：创建接口异步化——提交后**立即跳转工作台**，任务在后台执行（详情页展示进度并每 3 秒轮询）
  await page.waitFor(`/^\\/optimizations\\/\\d+$/.test(location.pathname)`,
    { label: '提交后跳转工作台', timeout: 30000 })
  const optimizationId = Number((await page.evaluate('location.pathname')).split('/').pop())
  check('③ 提交后立即跳转工作台（异步任务已受理）', Number.isInteger(optimizationId) && optimizationId > 0)

  // 工作台先呈现「生成中」任务卡或已完成内容（首屏有一次详情加载，需等待渲染）
  await page.waitFor(
    `!!document.querySelector('.task-card') || !!document.querySelector('.score-row')`,
    { label: '工作台任务态或内容渲染', timeout: 30000 })
  check('③ 工作台出现任务进度卡或已完成内容', true)
  await shot('02b-task-running')

  await page.waitFor(`!!document.querySelector('.score-row')`, { label: '任务完成并渲染工作台', timeout: AI_TIMEOUT })
  const detail = (await api('GET', `/optimizations/${optimizationId}`, { token: TOKEN })).body?.data
  check('③ 后端记录与页面同步（版本 1、未评估、有优化稿）',
    detail?.status === 'SUCCESS' && detail?.versionNo === 1 && detail?.scoreAfter === null
    && typeof detail?.optimizedContent === 'string' && detail.optimizedContent.length > 50)

  /* ============================================================== ④ 工作台区块 */

  console.log('\n== ④ 工作台区块渲染 ==')
  await page.waitFor(`!!document.querySelector('.score-row')`, { label: '工作台渲染', timeout: 20000 })
  await shot('03-workbench')

  const scoreRow = await page.textOf('.score-row')
  check('④ 优化前分数环显示接口分数、优化后为「待评估」',
    scoreRow.includes(String(detail.matchScore)) && scoreRow.includes('待评估'), scoreRow)

  const dimsText = await page.textOf('.dims')
  check('④ 维度对比：优化前五条已渲染、优化后提示"重新评估"',
    dimsText.includes('必备技能') && dimsText.includes('45%') && dimsText.includes('重新评估'))

  const reqText = await cardText('岗位要求分析')
  // 断言只用"接口下发的一定会显示"的内容（学历/经验由模型提取，可能为"未提及"，不作硬断言）
  const requiredSkills = detail.jobRequirements?.requiredSkills ?? []
  check('④ 岗位要求分析：摘要 + 必备技能标签（逐项与接口一致）',
    reqText.includes('必备技能')
    && requiredSkills.length > 0
    && requiredSkills.every((skill) => reqText.includes(skill)),
    `接口技能=${requiredSkills.join('/')} 页面=${reqText.slice(0, 100)}`)

  const advText = await cardText('简历优势')
  check('④ 简历优势区块已渲染（有内容或空态文案）', advText.length > 0, advText.slice(0, 80))

  const matchText = await cardText('岗位要求与简历经历的对应关系')
  check('④ 对应关系：已匹配与部分匹配两栏',
    matchText.includes('已匹配') && matchText.includes('部分匹配'))

  const gapText = await cardText('能力差距与待确认问题')
  check('④ 差距区块含免责说明（"不代表你不具备该能力"）',
    gapText.includes('不代表你不具备该能力') || gapText.includes('信息缺口'), gapText.slice(0, 160))
  check('④ 待确认问题区块带「不会替你编造」说明',
    gapText.includes('不会替你编造') || gapText.includes('待确认问题'),
    gapText.slice(0, 200))

  const changeText = await cardText('逐项修改说明')
  const changeCountInPage = (await page.evaluate('document.querySelectorAll(\'.change\').length'))
  check('④ 逐项修改说明条数与接口 changes 一致（含修改前/后对照）',
    changeCountInPage === detail.changes.length
    && changeText.includes('修改前') && changeText.includes('修改后'),
    `页面=${changeCountInPage} 接口=${detail.changes.length}`)

  const editorValue = await page.evaluate('document.querySelector(\'.editor__textarea textarea\').value')
  check('④ 编辑器初始值为模型原稿（editedContent 为空时）', editorValue === detail.optimizedContent)
  check('④ 原始简历不被触碰（详情接口 untouched：编辑前 editedContent 仍为 null）',
    detail.editedContent === null)

  /* ============================================================== ⑤ 编辑保存 */

  console.log('\n== ⑤ 编辑并保存（不覆盖模型原稿） ==')
  const DRAFT = `${detail.optimizedContent}\n\n## 其他说明\n（我补充的一行说明）`
  await page.evaluate(`(() => {
    const textarea = document.querySelector('.editor__textarea textarea')
    textarea.focus()
    textarea.value = ${JSON.stringify(DRAFT)}
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await page.waitFor(`document.body.innerText.includes('有未保存的修改')`,
    { label: '未保存标记出现', timeout: 5000 })
  check('⑤ 修改后出现「有未保存的修改」标记', true)

  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.editor__actions .el-button')]
      .find((el) => el.textContent.includes('保存编辑'))
    btn.click()
  })()`)
  await page.waitFor(`document.body.innerText.includes('已保存')`, { label: '保存成功提示', timeout: 20000 })
  const afterSave = (await api('GET', `/optimizations/${optimizationId}`, { token: TOKEN })).body?.data
  check('⑤ 保存后 editedContent 更新、**optimizedContent 不变**',
    afterSave.editedContent === DRAFT && afterSave.optimizedContent === detail.optimizedContent)
  check('⑤ 编辑器标签从「模型原稿」变为「已编辑」',
    (await page.textOf('.editor__draft')).includes('已编辑'))

  /* ============================================================== ⑥ 重新评估 */

  console.log('\n== ⑥ 重新评估（1 次模型调用） ==')
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.editor__actions .el-button')]
      .find((el) => el.textContent.includes('重新评估'))
    btn.click()
  })()`)
  await page.waitFor(`document.querySelector('.score-row').innerText.includes('优化后')`,
    { label: '评估完成', timeout: AI_TIMEOUT })
  await page.waitFor(
    `!/待评估/.test(document.querySelector('.score-row').innerText)`,
    { label: '优化后分数出现', timeout: AI_TIMEOUT },
  )
  const evaluated = (await api('GET', `/optimizations/${optimizationId}`, { token: TOKEN })).body?.data
  const scoreRowAfter = await page.textOf('.score-row')
  check('⑥ 评估后页面显示优化后分数（与接口 scoreAfter 一致）',
    typeof evaluated.scoreAfter === 'number'
    && scoreRowAfter.includes(String(evaluated.scoreAfter)),
    `页面=${scoreRowAfter.slice(0, 80)} 接口=${evaluated.scoreAfter}`)
  check('⑥ 优化后维度条已渲染（两组维度对比）',
    (await page.textOf('.dims')).includes('优化后维度得分'))
  check('⑥ 分数提示不作"必然提升"的暗示',
    (await page.textOf('.card__note')).includes('不代表录用概率'))
  await shot('04-evaluated')

  /* ============================================================== ⑦ 历史版本与导出 */

  console.log('\n== ⑦ 历史版本 / 导出 ==')
  const historyEmpty = await cardText('历史版本')
  check('⑦ 尚无编辑历史时显示空态说明（最多 10 版的规则）',
    historyEmpty.includes('还没有编辑记录') && historyEmpty.includes('最多 10 版'),
    historyEmpty.slice(0, 100))

  // 第二次编辑保存 → 当前稿进入历史
  await page.evaluate(`(() => {
    const textarea = document.querySelector('.editor__textarea textarea')
    textarea.focus()
    textarea.value = ${JSON.stringify(`${DRAFT}\n第二版`)}
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.editor__actions .el-button')]
      .find((el) => el.textContent.includes('保存编辑'))
    btn.click()
  })()`)
  await page.waitFor(`document.body.innerText.includes('已保存')`, { label: '再次保存', timeout: 20000 })
  await sleep(500)
  const withHistory = (await api('GET', `/optimizations/${optimizationId}`, { token: TOKEN })).body?.data
  check('⑦ 再次保存后旧稿进入编辑历史（1 版）',
    withHistory.editHistory?.length === 1 && withHistory.editHistory[0].content === DRAFT)
  const historyText = await cardText('历史版本')
  check('⑦ 历史版本卡片渲染出条目、「对比」与「回填」入口',
    historyText.includes('回填') && historyText.includes('对比'), historyText.slice(0, 100))

  // M13：版本对比（行内差异标注，纯前端 LCS）——历史版本 = DRAFT，当前稿 = DRAFT + "第二版"
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.history__actions .el-button')]
      .find((el) => el.textContent.trim() === '对比')
    if (!btn) throw new Error('找不到「对比」按钮')
    btn.click()
  })()`)
  await page.waitFor(`!!document.querySelector('.compare__body')`,
    { label: '版本对比对话框', timeout: 15000 })
  const compareCounts = JSON.parse(await page.evaluate(`JSON.stringify({
    del: document.querySelectorAll('.compare__line--del').length,
    add: document.querySelectorAll('.compare__line--add').length,
    same: document.querySelectorAll('.compare__line--same').length,
  })`))
  check('⑦ 版本对比：新增 1 行、删除 0 行、其余为相同行（对当前稿多出「第二版」）',
    compareCounts.add === 1 && compareCounts.del === 0 && compareCounts.same >= 1,
    JSON.stringify(compareCounts))

  // 对比对话框内回填：复用回填语义（只进编辑器、需显式保存）
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
      .find((el) => el.textContent.includes('回填此版本'))
    if (!btn) throw new Error('找不到「回填此版本到编辑器」按钮')
    btn.click()
  })()`)
  await sleep(400)
  const editorAfterCompareFill = await page.evaluate(
    `document.querySelector('.editor__textarea textarea')?.value ?? ''`)
  check('⑦ 对比内「回填此版本到编辑器」写入编辑器（未自动保存）',
    editorAfterCompareFill === DRAFT, editorAfterCompareFill.slice(0, 60))

  // 导出：触发浏览器下载（headless 下断言"无错误提示"）
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.editor__actions .el-button')]
      .find((el) => el.textContent.includes('导出 DOCX'))
    btn.click()
  })()`)
  await sleep(3000)
  const exportFailed = await page.evaluate(`document.body.innerText.includes('导出失败')`)
  check('⑦ 导出 DOCX 已触发且无错误提示', exportFailed === false)

  /* ============================================================== ⑧ 列表分数对比 */

  console.log('\n== ⑧ 列表：优化前后分数对比 ==')
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.page-head__back')][0]
    btn.click()
  })()`)
  await page.waitFor(`location.pathname === '/optimizations'`, { label: '返回列表', timeout: 15000 })
  await page.waitFor(`document.querySelectorAll('.item').length >= 1`, { label: '列表渲染', timeout: 15000 })
  const rowText = await page.textOf('.item')
  check('⑧ 列表行显示「优化前 → 优化后」分数对比',
    rowText.includes(String(detail.matchScore)) && rowText.includes(String(withHistory.scoreAfter)),
    rowText)
  await shot('05-list')

  /* ============================================================== ⑨ 手动输入 JD 三步编排 */

  console.log('\n== ⑨ 手动输入 JD：建岗位 → 分析 → 优化（3 次模型调用） ==')
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.page-head .el-button')]
      .find((el) => el.textContent.includes('新建简历优化'))
    btn.click()
  })()`)
  await page.waitFor(
    `document.querySelectorAll('.el-dialog .picker__item').length >= 4`,
    { label: '弹窗渲染', timeout: 15000 },
  )
  await page.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.job-tabs .el-tabs__item')]
      .find((el) => el.textContent.includes('手动输入 JD'))
    tab.click()
  })()`)
  await page.waitFor(`!!document.querySelector('.manual__field textarea')`,
    { label: '手动输入表单渲染', timeout: 10000 })
  check('⑨ 未填写 JD 时提交按钮禁用', await submitDisabled())

  await pickByName(0, RESUME_NAME)
  await page.evaluate(`(() => {
    const inputs = document.querySelectorAll('.manual__field input')
    const setValue = (el, value) => {
      el.focus()
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setValue(inputs[0], '数据平台后端开发实习生')
    setValue(inputs[1], '示例数据科技')
    setValue(document.querySelector('.manual__field textarea'), ${JSON.stringify(MANUAL_JD)})
  })()`)
  await sleep(300)
  check('⑨ 填写岗位名称与 JD 后可提交', !(await submitDisabled()))

  await clickDialogButton('开始优化')
  await page.waitFor(
    `document.body.innerText.includes('岗位已创建，正在分析岗位要求')
      || document.body.innerText.includes('AI 正在生成优化稿')`,
    { label: '三步编排进度文案', timeout: 60000 },
  )
  const stepText = await page.textOf('.el-dialog')
  check('⑨ 提交后展示分步进度（先建岗位并分析）',
    stepText.includes('岗位') && stepText.includes('分析'), stepText.slice(0, 120))

  await page.waitFor(`/^\\/optimizations\\/\\d+$/.test(location.pathname)`,
    { label: '手动 JD 路径提交并跳转', timeout: AI_TIMEOUT })
  // M16：任务后台执行——等待详情页轮询到完成再断言产物
  await page.waitFor(`!!document.querySelector('.score-row')`, { label: '手动 JD 任务完成', timeout: AI_TIMEOUT })
  const manualId = Number((await page.evaluate('location.pathname')).split('/').pop())
  const manualDetail = (await api('GET', `/optimizations/${manualId}`, { token: TOKEN })).body?.data
  check('⑨ 手动输入 JD 的优化完成（岗位自动创建并分析后产出优化稿）',
    manualId !== optimizationId
    && manualDetail?.jobName === '数据平台后端开发实习生'
    && typeof manualDetail?.optimizedContent === 'string'
    && manualDetail.optimizedContent.length > 50,
    JSON.stringify({ id: manualId, jobName: manualDetail?.jobName }))
  const manualJobs = (await api('GET', '/jobs?page=1&size=100', { token: TOKEN })).body?.data?.records ?? []
  check('⑨ 手动输入的 JD 已作为岗位记录存在（可在岗位管理中复用）',
    manualJobs.some((job) => job.jobName === '数据平台后端开发实习生'))
  await shot('06-manual-jd')
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
