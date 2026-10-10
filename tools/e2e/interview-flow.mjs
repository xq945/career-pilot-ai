/**
 * 面试模块端到端验证（真实浏览器 + 真实模型调用）。
 *
 * 覆盖《开发顺序》M7 的验收标准与《前端原型设计》§5.9–§5.11 对应的页面行为：
 * 创建弹窗校验拦截、出题等待态、**进度分母用实际题数**（与接口 questions.length 对照）、
 * 逐题作答与评价渲染、列表「进行中 x/y」与顶部提醒、报告页未完成态、
 * 全部作答后的总分/总评、重答确认弹窗与**总分即时重算**、报告页「查看回答」展开。
 *
 * 接口层的越权矩阵、边界校验与 502 失败态由 curl 验证（见《验证记录》§9），
 * 本脚本只补浏览器独有的部分。**本脚本会消耗真实模型 token
 * （出题 1 次 + 评价 3 次 + 总评 2 次，题目数固定为 2 以控制消耗）**。
 *
 * 前置条件：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 * 与岗位脚本并行跑时用不同的浏览器端口（本脚本默认 9223）。
 *
 * 用法：
 *   node tools/e2e/interview-flow.mjs
 *   node tools/e2e/interview-flow.mjs --shots ./tmp/shots-interview
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
const PORT = Number(argValue('port', '9223'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_intv_${STAMP}`
const PASS = 'Test1234'

/** 真实模型调用的等待上限（出题 10–40s、评价 10–30s、含总评更久） */
const MODEL_TIMEOUT = 150000

const { check, summary } = createChecker()

const JOB_NAME = 'Java 后端开发实习生'
const COMPANY = '示例科技'
const JOB_DESC = '岗位职责：\n1. 参与核心业务系统的后端开发，负责接口设计与实现；\n2. 配合前端完成联调与问题排查。\n\n'
  + '任职要求：\n1. 熟悉 Java 基础与 Spring Boot 框架；\n2. 熟悉 MySQL 索引与常见优化手段；\n3. 了解 Redis 缓存的基本使用。'

const ANSWER_1 = '我会先按资源建模设计 RESTful 路径，用 HTTP 方法表达操作语义；'
  + '参数校验用 jakarta validation 注解声明在请求 DTO 上，配合全局异常处理器统一返回错误结构。'
const ANSWER_1_V2 = '我会用名词复数表示资源路径，用 HTTP 状态码表达语义（创建 201、删除 204、参数错误 400）；'
  + '请求 DTO 与实体分离，Controller 参数加 @Valid 触发校验，嵌套对象也要加 @Valid；'
  + '所有接口统一走 Result 包装类返回，避免手工拼装；联调时先确认接口是否走统一包装，再排查 Jackson 命名策略与日期格式配置。'
const ANSWER_2 = 'ArrayList 基于动态数组，随机访问快、中间插入删除要移动元素；'
  + 'LinkedList 基于双向链表，头尾插入删除快、随机访问需要遍历。'
  + '所以读多写少用 ArrayList，频繁头尾操作用 LinkedList 或 ArrayDeque。'

// ---------------------------------------------------------------- 准备测试账号与岗位

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
const userId = seed.data.id

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: USER, password: PASS }),
}).then((r) => r.json())
if (login.code !== 0) {
  console.error(`❌ 测试账号登录失败：${login.message}`)
  process.exit(1)
}
const TOKEN = login.data.token

/** 带 token 的接口调用（脚本内的交叉验证用，不经过浏览器） */
const api = (path, options = {}) => fetch(`${API}${path}`, {
  ...options,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...options.headers },
}).then((r) => r.json())

const job = await api('/jobs', {
  method: 'POST',
  body: JSON.stringify({ companyName: COMPANY, jobName: JOB_NAME, description: JOB_DESC }),
})
if (job.code !== 0) {
  console.error(`❌ 创建岗位失败：${job.message}`)
  process.exit(1)
}
console.log(`已创建测试账号 ${USER} 与岗位 #${job.data.id}\n`)

// ---------------------------------------------------------------- 启动浏览器

const browser = await launchBrowser({ port: PORT })
const page = await connect({ port: PORT })
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})

/** 截图（先等 el-tag 的进入动画结束，见 tools/e2e/README.md 的坑清单） */
const shot = async (name) => {
  if (SHOTS) {
    await page
      .waitFor(
        `![...document.querySelectorAll('.el-tag')].some((el) => el.className.includes('enter-active'))`,
        { label: '标签动画结束', timeout: 5000 },
      )
      .catch(() => {})
    await sleep(250)
    await page.screenshot(`${SHOTS}/${name}.png`)
  }
}

const messageBoxText = () => page.evaluate(
  `(() => { const el = document.querySelector('.el-message-box'); return el ? el.innerText : '' })()`)

const clickMessageBoxConfirm = () => page.evaluate(`(() => {
  const btn = document.querySelector('.el-message-box__btns .el-button--primary')
  if (!btn) throw new Error('找不到确认按钮')
  btn.click()
  return true
})()`)

const clickDialogButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.trim() === '${text}')
  if (!btn) throw new Error('找不到弹窗按钮：${text}')
  btn.click()
  return true
})()`)

const clickPageHeadButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.page-head .el-button')]
    .find((el) => el.textContent.includes('${text}'))
  if (!btn) throw new Error('找不到页头按钮：${text}')
  btn.click()
  return true
})()`)

const clickPageButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-button')]
    .find((el) => el.textContent.trim() === '${text}' && el.offsetParent !== null)
  if (!btn) throw new Error('找不到按钮：${text}')
  btn.click()
  return true
})()`)

const clickItemButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.item .el-button')]
    .find((el) => el.textContent.trim() === '${text}')
  if (!btn) throw new Error('找不到列表按钮：${text}')
  btn.click()
  return true
})()`)

/** 弹窗内选择 el-select 的选项（按文本包含匹配） */
const selectDialogOption = async (text) => {
  await page.evaluate(`(() => {
    const wrapper = document.querySelector('.el-dialog .el-select .el-select__wrapper')
      || document.querySelector('.el-dialog .el-select')
    if (!wrapper) throw new Error('找不到下拉框')
    wrapper.click()
    return true
  })()`)
  await sleep(400)
  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.el-select-dropdown__item')]
      .find((el) => el.textContent.includes('${text}'))
    if (!item) throw new Error('找不到选项：${text}')
    item.click()
    return true
  })()`)
  await sleep(300)
}

/** 当前 ElMessage 是否包含指定文案 */
const hasMessage = (text) => page.evaluate(
  `[...document.querySelectorAll('.el-message')].some((e) => e.textContent.includes('${text}'))`)

/** 答题页正文：当前题的题干与回答区是否渲染完成 */
const waitSessionReady = () => page.waitFor(
  `document.querySelector('.question-card__text') !== null
   && document.querySelector('.answer-block .el-textarea__inner') !== null`,
  { label: '答题页渲染完成', timeout: 20000 })

/** 等评价完成（评价卡出现分数大数字） */
const waitReviewDone = () => page.waitFor(
  `document.querySelector('.review__num') !== null`,
  { label: '评价结果渲染', timeout: MODEL_TIMEOUT })

/** 点击题号导航的第 index 项（0 起） */
const goToQuestion = async (index) => {
  await page.evaluate(`(() => {
    const items = [...document.querySelectorAll('.nav__item')]
    if (!items[${index}]) throw new Error('题号导航项不存在')
    items[${index}].click()
    return true
  })()`)
  await sleep(400)
}

/** 提交当前题（按钮文案「提交回答」/「更新回答」） */
const submitCurrent = async () => {
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.answer-block__actions .el-button')][0]
    if (!btn) throw new Error('找不到提交按钮')
    btn.click()
    return true
  })()`)
}

/** 当前题的提交按钮文案 */
const submitButtonText = () => page.evaluate(
  `document.querySelector('.answer-block__actions .el-button')?.textContent?.trim() ?? ''`)

try {
  // ------------------------------------------------------------ ① 登录并进入面试页（空态）

  await page.goto(`${BASE}/interviews`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/interviews`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向到登录页', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/interviews'`, { label: '登录后回跳面试页', timeout: 20000 })
  await page.waitFor(
    `document.querySelector('.state__title')?.textContent?.includes('还没有面试记录') === true`,
    { label: '空态渲染', timeout: 20000 })

  const emptyText = await page.textOf('.state')
  check('① 空态：文案说明用途并给出开始入口',
    emptyText.includes('还没有面试记录') && emptyText.includes('选择一个已录入的岗位'),
    emptyText.replace(/\s+/g, ' ').slice(0, 60))
  await shot('01-interviews-empty')

  // ------------------------------------------------------------ ② 创建弹窗：校验拦截 → 出题

  await clickPageHeadButton('新建模拟面试')
  await page.waitFor(
    `(() => { const el = document.querySelector('.el-dialog'); return !!el && el.offsetParent !== null })()`,
    { label: '创建弹窗打开' })
  await page.waitFor(
    `[...document.querySelectorAll('.el-dialog__footer .el-button')].some((el) => el.textContent.trim() === '生成题目')`,
    { label: '弹窗渲染完成' })

  // 空表单提交 → 必填校验拦截（岗位与名称），不发请求
  await clickDialogButton('生成题目')
  await sleep(500)
  const emptyErrors = await page.evaluate(
    `[...document.querySelectorAll('.el-dialog .el-form-item__error')].map((e) => e.textContent.trim())`)
  check('② 空表单提交被拦截（岗位/名称必填提示，弹窗未关闭）',
    emptyErrors.length >= 2 && await page.evaluate(
      `(() => { const el = document.querySelector('.el-dialog'); return !!el && el.offsetParent !== null })()`),
    emptyErrors.join('/'))

  // 选择题型专项（Java 基础）与岗位；名称随岗位自动联动
  await page.evaluate(`(() => {
    const radios = [...document.querySelectorAll('.el-dialog .el-radio-button')]
    const java = radios.find((el) => el.textContent.trim() === 'Java 基础')
    if (!java) throw new Error('找不到题型选项')
    java.click()
    return true
  })()`)
  await selectDialogOption(JOB_NAME)

  const linkedTitle = await page.evaluate(
    `document.querySelector('.el-dialog .el-form-item:nth-child(2) .el-input__inner')?.value ?? ''`)
  check('   选择岗位后名称自动联动为「{岗位名}模拟面试」',
    linkedTitle === `${JOB_NAME}模拟面试`, linkedTitle)

  // 题目数量改为 2（控制模型消耗）：先试原生 setter 填值，不生效则逐次点减号
  await page.fill(0, '2', '.el-dialog .el-input-number .el-input__inner')
  await sleep(400)
  let countValue = await page.evaluate(
    `document.querySelector('.el-dialog .el-input-number .el-input__inner')?.value ?? ''`)
  for (let i = 0; i < 4 && countValue !== '2'; i++) {
    await page.evaluate(`document.querySelector('.el-dialog .el-input-number__decrease')?.click()`)
    await sleep(250)
    countValue = await page.evaluate(
      `document.querySelector('.el-dialog .el-input-number .el-input__inner')?.value ?? ''`)
  }
  check('   题目数量可调整为 2', countValue === '2', countValue)
  await shot('02-create-dialog')

  await clickDialogButton('生成题目')
  await page.waitFor(
    `document.querySelector('.ai-waiting__title')?.textContent?.includes('正在生成面试题') === true`,
    { label: '出题等待态出现', timeout: 10000 })
  check('③ 出题进入等待态（含「正在生成面试题」与耗时说明）',
    (await page.textOf('.ai-waiting')).includes('10–40 秒'),
    (await page.textOf('.ai-waiting')).replace(/\s+/g, ' ').slice(0, 50))
  await shot('03-generating')

  await page.waitFor(`/^\\/interviews\\/\\d+$/.test(location.pathname)`,
    { label: '出题成功跳转答题页', timeout: MODEL_TIMEOUT })
  await page.waitFor(`document.querySelector('.ai-waiting__title') === null`,
    { label: '等待态消失', timeout: MODEL_TIMEOUT })
  const sessionUrl = await page.evaluate('location.pathname')
  const sessionId = Number(sessionUrl.split('/').pop())
  console.log(`   （会话 #${sessionId} 已创建）`)

  // ------------------------------------------------------------ ③ 答题页：进度分母 = 实际题数

  await waitSessionReady()
  const detail = await api(`/interviews/${sessionId}`)
  const realCount = detail.data.questions.length

  const progressText = await page.textOf('.progress__text')
  check('④ 进度分母取实际题数（与接口 questions.length 对照）',
    progressText.includes(`已答 0 / ${realCount} 题`) && realCount > 0,
    `页面「${progressText.trim()}」· 接口题数 ${realCount}`)

  const navCount = await page.evaluate(`document.querySelectorAll('.nav__item').length`)
  check('   题号导航项数与题数一致', navCount === realCount, `导航 ${navCount} / 题数 ${realCount}`)
  await shot('04-session-first-question')

  // ------------------------------------------------------------ ④ 作答第 1 题：评价渲染

  await page.fill(0, ANSWER_1, '.answer-block .el-textarea__inner')
  await submitCurrent()
  await page.waitFor(
    `document.querySelector('.ai-waiting__title')?.textContent?.includes('正在批改') === true`,
    { label: '评价等待态出现', timeout: 10000 })
  await waitReviewDone()

  const firstScore = Number(await page.textOf('.review__num'))
  const reviewText = await page.textOf('.review')
  check('⑤ 第 1 题评价渲染：得分 0–100、点评/参考答案/改进建议齐备',
    firstScore >= 0 && firstScore <= 100
      && reviewText.includes('AI 点评') && reviewText.includes('参考答案') && reviewText.includes('改进建议'),
    `${firstScore} 分`)
  check('   提交按钮变为「更新回答」', (await submitButtonText()) === '更新回答', await submitButtonText())
  check('   题号导航第 1 项标记完成并显示得分',
    (await page.evaluate(`document.querySelectorAll('.nav__item')[0].textContent`)).includes(String(firstScore)),
    await page.evaluate(`document.querySelectorAll('.nav__item')[0].textContent.trim()`))
  await shot('05-first-review')

  // ------------------------------------------------------------ ⑤ 列表：进行中 + 顶部提醒

  await page.goto(`${BASE}/interviews`)
  await page.waitFor(
    `document.querySelector('.item__title')?.textContent !== undefined`,
    { label: '列表渲染', timeout: 20000 })
  const ongoingTag = await page.textOf('.item__title')
  check('⑥ 列表显示「进行中 · 1/2」（分母为实际题数）',
    ongoingTag.includes(`进行中 · 1/${realCount}`),
    ongoingTag.replace(/\s+/g, ' ').slice(0, 50))
  const alertText = await page.textOf('.el-alert')
  check('   顶部出现「继续答题」提醒', alertText.includes('继续答题') && alertText.includes(`已答 1 / ${realCount}`),
    alertText.replace(/\s+/g, ' ').slice(0, 60))
  await shot('06-list-ongoing')

  // ------------------------------------------------------------ ⑥ 报告页（未完成态）

  // 进行中的会话在列表里的主操作是「继续答题」，报告页直接按 URL 进入（等价入口）
  await page.goto(`${BASE}/interviews/${sessionId}/report`)
  await page.waitFor(`/^\\/interviews\\/\\d+\\/report$/.test(location.pathname)`,
    { label: '跳转报告页', timeout: 20000 })
  await page.waitFor(`document.querySelector('.unfinished') !== null`,
    { label: '未完成态渲染', timeout: 20000 })

  const unfinishedText = await page.textOf('.unfinished')
  check('⑦ 未完成报告：显示「本场面试尚未完成」+ 进度，不显示总分环',
    unfinishedText.includes('本场面试尚未完成')
      && unfinishedText.includes(`已答 1 / ${realCount}`)
      && await page.evaluate(`document.querySelector('.score-row__ring') === null`),
    unfinishedText.replace(/\s+/g, ' ').slice(0, 60))
  const skippedRow = await page.evaluate(
    `(() => { const el = [...document.querySelectorAll('.detail')].find((d) => d.textContent.includes('未作答'));
       return el ? el.textContent : '' })()`)
  check('   未作答行显示「未作答」并给出「去作答」入口',
    skippedRow.includes('未作答') && skippedRow.includes('去作答'),
    skippedRow.replace(/\s+/g, ' ').slice(0, 60))
  await shot('07-report-unfinished')

  // ------------------------------------------------------------ ⑦ 答完剩余题目（触发总分与总评）

  await clickPageButton('继续答题')
  await page.waitFor(`/^\\/interviews\\/\\d+$/.test(location.pathname)`, { label: '回到答题页', timeout: 20000 })
  await waitSessionReady()
  await goToQuestion(1)
  await page.fill(0, ANSWER_2, '.answer-block .el-textarea__inner')
  await submitCurrent()
  await waitReviewDone()
  const secondScore = Number(await page.textOf('.review__num'))
  await sleep(800)
  check('⑧ 最后一题提交后提示「全部题目已作答」并生成总分与总评',
    await hasMessage('全部题目已作答'),
    `第 2 题得分 ${secondScore}`)

  // ------------------------------------------------------------ ⑧ 报告页（已完成态）

  await page.goto(`${BASE}/interviews/${sessionId}/report`)
  await page.waitFor(`document.querySelector('.score-row__ring') !== null`,
    { label: '已完成态渲染', timeout: 20000 })
  await page.waitFor(
    `![...document.querySelectorAll('.el-tag')].some((el) => el.className.includes('enter-active'))`,
    { label: '标签动画结束', timeout: 5000 }).catch(() => {})

  const report = (await api(`/interviews/${sessionId}/report`)).data
  const ringScore = Number(await page.textOf('.score-ring__num').then((t) => t.replace('分', '')))
  check('⑨ 报告总分环 = 接口 totalScore（保留两位小数的展示值）',
    ringScore === Number(report.totalScore),
    `页面 ${ringScore} · 接口 ${report.totalScore}`)

  const summaryText = await page.textOf('.score-row__summary')
  check('   总评区渲染：总评文本 + 强项/待提升标签',
    report.overallSummary !== null && summaryText.includes(report.overallSummary.slice(0, 12))
      && summaryText.includes('强项'),
    summaryText.replace(/\s+/g, ' ').slice(0, 60))

  const barRows = await page.evaluate(`document.querySelectorAll('.bar-row').length`)
  check('   分类得分行数与接口 categoryScores 一致',
    barRows === report.categoryScores.length,
    `页面 ${barRows} 行 · 接口 ${report.categoryScores.length} 组`)
  await shot('08-report-completed')

  // 查看回答：展开第 1 题，显示回答与点评（数据来自报告响应，无额外请求）
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.detail .el-button')].find((el) => el.textContent.includes('查看回答'))
    if (!btn) throw new Error('找不到「查看回答」')
    btn.click()
    return true
  })()`)
  await sleep(400)
  const expandedBody = await page.textOf('.detail__body')
  const firstReportQuestion = report.questions[0]
  check('   「查看回答」展开显示我的回答与 AI 点评',
    expandedBody.includes(firstReportQuestion.answer.slice(0, 15))
      && expandedBody.includes(firstReportQuestion.analysis.slice(0, 15)),
    expandedBody.replace(/\s+/g, ' ').slice(0, 60))
  await shot('09-report-expanded')

  // ------------------------------------------------------------ ⑨ 重答：确认弹窗 + 总分即时重算

  await page.goto(`${BASE}/interviews/${sessionId}`)
  await waitSessionReady()
  await page.fill(0, ANSWER_1_V2, '.answer-block .el-textarea__inner')
  await submitCurrent()
  await page.waitFor(
    `(() => { const el = document.querySelector('.el-message-box'); return !!el && el.offsetParent !== null })()`,
    { label: '重答确认弹窗出现', timeout: 10000 })

  const confirmText = await messageBoxText()
  check('⑩ 重答确认弹窗含三条说明（覆盖 / 以最后一次为准 / 总分即时重算）',
    confirmText.includes('覆盖') && confirmText.includes('最后一次为准') && confirmText.includes('总分即时重算'),
    confirmText.replace(/\s+/g, ' ').slice(0, 70))
  await shot('10-reanswer-confirm')

  await clickMessageBoxConfirm()
  await waitReviewDone()
  const newScore = Number(await page.textOf('.review__num'))

  const after = (await api(`/interviews/${sessionId}/report`)).data
  const expected = Math.round(((newScore + secondScore) / 2) * 100) / 100
  check('   重答后总分即时重算（= 两题最新得分的平均）',
    Number(after.totalScore) === expected,
    `接口 ${after.totalScore} · 期望 ${expected}（重答 ${newScore} / 第 2 题 ${secondScore}）`)
  check('   重答后会话保持已完成', after.completed === true && after.status === 1,
    `completed=${after.completed} status=${after.status}`)

  await page.goto(`${BASE}/interviews/${sessionId}/report`)
  await page.waitFor(`document.querySelector('.score-row__ring') !== null`,
    { label: '重答后报告页渲染', timeout: 20000 })
  const ringAfter = Number(await page.textOf('.score-ring__num').then((t) => t.replace('分', '')))
  check('   报告页总分环同步更新', ringAfter === Number(after.totalScore),
    `页面 ${ringAfter} · 接口 ${after.totalScore}`)
  await shot('11-report-after-reanswer')

  // ------------------------------------------------------------ ⑩ 列表已完成态 + 收尾

  await page.goto(`${BASE}/interviews`)
  await page.waitFor(`document.querySelector('.item__title') !== null`, { label: '列表渲染', timeout: 20000 })
  const doneTitle = await page.textOf('.item__title')
  const doneButtons = await page.evaluate(
    `[...document.querySelectorAll('.item .el-button')].map((el) => el.textContent.trim())`)
  check('⑪ 列表显示已完成与总分，主操作为「查看报告」',
    doneTitle.includes('已完成') && doneTitle.includes('分') && doneButtons.includes('查看报告'),
    doneTitle.replace(/\s+/g, ' ').slice(0, 50))
  check('   已完成时不再出现「进行中」提醒',
    await page.evaluate(`document.querySelector('.el-alert') === null`))
  await shot('12-list-completed')
}
catch (error) {
  console.error(`\n❌ 脚本执行中断：${error.message}`)
  check('脚本完整执行', false, error.message)
}
finally {
  const result = summary()

  console.log('\n—'.repeat(30))
  console.log('清理数据（后端无删除用户接口，需手工执行；注意外键顺序）：')
  console.log(`  DELETE FROM interview_question WHERE session_id IN (SELECT id FROM interview_session WHERE user_id = ${userId});`)
  console.log(`  DELETE FROM interview_session WHERE user_id = ${userId};`)
  console.log(`  DELETE FROM job WHERE user_id = ${userId};`)
  console.log(`  DELETE FROM sys_user WHERE id = ${userId};`)

  await closeBrowser(browser)
  process.exit(result.failed > 0 ? 1 : 0)
}
