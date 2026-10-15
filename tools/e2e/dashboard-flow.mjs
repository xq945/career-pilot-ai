/**
 * 工作台端到端（**零模型调用**）：空态 → 快捷操作与 query 入口 → 接口层造数据 →
 * 统计卡与四组最近记录 → 工作流资源选择与就地拦截 → 登录用户数据隔离。
 *
 * 与 full-chain-flow.mjs 的分工：本脚本覆盖工作台自身的布局、数据接入、跳转与
 * 权限隔离，**不触发任何 AI 调用**（简历与岗位只创建、不分析）；五步工作流的
 * 完整跑通（匹配 → 优化 → 面试）由 full-chain-flow.mjs 覆盖。
 *
 * 前置：后端（8080，**APP_CAPTCHA_ENABLED=false**）与前端 dev server（5173）都已启动。
 *      验证码开启时登录拿不到 Token，本脚本会在前置检查处直接报错退出。
 * 用法：
 *   node tools/e2e/dashboard-flow.mjs
 *   node tools/e2e/dashboard-flow.mjs --shots ./tmp/shots-dashboard
 */
import { closeBrowser, connect, createChecker, launchBrowser, sleep } from './cdp.mjs'
import { buildTxt } from './fixtures.mjs'

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
const USER_A = `e2e_dash_a_${STAMP}`
const USER_B = `e2e_dash_b_${STAMP}`
const PASS = 'Test1234'

const RESUME_NAME = `工作台简历${STAMP}`
const RESUME_TEXT = '姓名：赵六。本科，计算机科学与技术。技能：Java、Spring Boot、MySQL、Redis。'
  + '项目经历：校园图书管理系统后端开发，负责借阅与检索模块的接口设计与实现。'
const COMPANY = '工作台科技'
const JOB_NAME = `工作台岗位${STAMP}`
const JOB_DESC = '岗位职责：\n1. 负责业务系统后端接口设计与实现；\n2. 参与数据库表结构设计与优化。\n\n'
  + '任职要求：\n1. 熟悉 Java 与 Spring Boot；\n2. 熟悉 MySQL 索引优化；\n3. 了解 Redis 缓存。'

const { check, summary } = createChecker()

// ---------------------------------------------------------------- 准备账号

const post = (path, body, token) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
}).then((r) => r.json())

async function registerAndLogin(username) {
  const reg = await post('/auth/register', {
    username, email: `${username}@example.com`, password: PASS,
  }).catch((error) => ({ code: -1, message: error.message }))
  if (reg.code !== 0) {
    console.error(`❌ 注册失败（后端未启动？）：${reg.message || JSON.stringify(reg)}`)
    process.exit(1)
  }
  const login = await post('/auth/login', { account: username, password: PASS })
  if (login.code !== 0) {
    console.error(`❌ 登录失败：${login.message}`
      + '（验证码开启时请以 APP_CAPTCHA_ENABLED=false 重启后端）')
    process.exit(1)
  }
  return login.data
}

console.log(`前置检查：后端 ${API} / 前端 ${BASE}\n`)

const authA = await registerAndLogin(USER_A)
const authB = await registerAndLogin(USER_B)
console.log(`已创建测试账号 ${USER_A}（id=${authA.user?.id}）与 ${USER_B}\n`)

/** 账号 A 造数据：一份未分析的简历 + 一个未分析的岗位（均为接口层，零模型调用） */
async function seedAccountA() {
  const form = new FormData()
  form.append('file', new Blob([buildTxt(RESUME_TEXT)], { type: 'text/plain' }), `${RESUME_NAME}.txt`)
  form.append('name', RESUME_NAME)
  const resume = await fetch(`${API}/resumes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authA.token}` },
    body: form,
  }).then((r) => r.json())
  if (resume.code !== 0) {
    throw new Error(`上传简历失败：${resume.message}`)
  }

  const job = await post('/jobs', {
    jobName: JOB_NAME, companyName: COMPANY, description: JOB_DESC,
  }, authA.token)
  if (job.code !== 0) {
    throw new Error(`创建岗位失败：${job.message}`)
  }
  return { resumeId: resume.data.id, jobId: job.data.id }
}

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

/**
 * 注入登录态后进入工作台。
 *
 * 必须先 goto 到站点（让 Pinia store 初始化）、再写 localStorage、**再整页导航**——
 * `Page.navigate` 会重新加载应用，store 才会读到刚写入的 Token；只在 SPA 内跳转
 * 读到的仍是旧值。登录链路本身由 auth-flow.mjs 覆盖，这里走捷径只为聚焦工作台。
 */
async function signIn(auth) {
  await page.goto(`${BASE}/login`)
  await page.evaluate(`(() => {
    localStorage.setItem('token', ${JSON.stringify(auth.token)})
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(auth.user))})
    return true
  })()`)
  await page.goto(`${BASE}/dashboard`)
}

const DIALOG_VISIBLE = `(() => {
  const el = document.querySelector('.el-dialog')
  return !!el && el.offsetParent !== null
})()`

/** 四张统计卡的文本（换行折叠为空格） */
const cardTexts = () => page.evaluate(
  `[...document.querySelectorAll('.stat')].map((el) => el.innerText.replace(/\\n/g, ' '))`)

/** 某个最近记录区块的行文本（按卡片标题定位，避免跨区块串判） */
const rowsIn = (title) => page.evaluate(`(() => {
  const card = [...document.querySelectorAll('.el-card')].find(
    (c) => c.querySelector('.card__head h2')?.textContent.trim() === ${JSON.stringify(title)})
  return card ? [...card.querySelectorAll('.recent-row')].map((el) => el.innerText.replace(/\\n/g, ' ')) : []
})()`)

/** 侧栏当前激活项文本 */
const activeNavText = () => page.evaluate(
  `document.querySelector('.sidebar__nav .el-menu-item.is-active')?.textContent.trim() || ''`)

/** 点快捷操作按钮（欢迎区） */
const clickQuickAction = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.welcome__actions .el-button')]
    .find((el) => el.textContent.includes(${JSON.stringify(text)}))
  if (!btn) throw new Error('找不到快捷操作：' + ${JSON.stringify(text)})
  btn.click()
  return true
})()`)

/** 点某个工作流步骤内的按钮（按步骤标题定位） */
const clickStepButton = (stepTitle, btnText) => page.evaluate(`(() => {
  const step = [...document.querySelectorAll('.step')].find(
    (el) => el.querySelector('.step__title')?.textContent.trim() === ${JSON.stringify(stepTitle)})
  if (!step) throw new Error('找不到步骤：' + ${JSON.stringify(stepTitle)})
  const btn = [...step.querySelectorAll('.el-button')]
    .find((el) => el.textContent.trim() === ${JSON.stringify(btnText)})
  if (!btn) throw new Error('找不到步骤按钮：' + ${JSON.stringify(btnText)})
  btn.click()
  return true
})()`)

/** 在工作流弹窗的资源选择器里按名称选中一项 */
const pickInDialog = (name) => page.evaluate(`(() => {
  const picker = document.querySelector('.el-dialog .picker')
  if (!picker) throw new Error('弹窗内没有资源选择器')
  const item = [...picker.querySelectorAll('.picker__item')]
    .find((el) => el.textContent.includes(${JSON.stringify(name)}))
  if (!item) throw new Error('找不到资源：' + ${JSON.stringify(name)})
  item.querySelector('.picker__radio').click()
  return true
})()`)

const clickDialogButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.trim() === ${JSON.stringify(text)})
  if (!btn) throw new Error('找不到弹窗按钮：' + ${JSON.stringify(text)})
  btn.click()
  return true
})()`)

// ---------------------------------------------------------------- 主流程

try {
  // ============================================================== ① 空态

  await signIn(authA)
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '统计卡渲染', timeout: 20000 })
  await page.waitFor(`!!document.querySelector('.progress-row')`, { label: '工作流进度渲染', timeout: 20000 })
  await page.waitFor(`document.querySelectorAll('.recent-row, .el-card .state').length >= 1`, { label: '最近记录渲染', timeout: 20000 })

  check('① 导航菜单首项为「工作台」且文档标题同步',
    (await activeNavText()) === '工作台'
    && (await page.evaluate('document.title')) === '工作台 · 智能求职辅助平台',
    `激活项=${await activeNavText()} / 标题=${await page.evaluate('document.title')}`)

  const emptyCards = await cardTexts()
  check('   新账号四卡计数全 0',
    emptyCards.length === 4 && emptyCards.every((t) => /(^|\s)0[份个次场]/.test(t)),
    emptyCards.join(' / '))

  check('   核心工作流 0/5',
    (await page.textOf('.progress-row')).includes('已完成 0 / 5'),
    await page.textOf('.progress-row'))

  const emptyBody = await page.evaluate('document.body.innerText')
  check('   四组最近记录均为空态引导文案',
    emptyBody.includes('还没有简历') && emptyBody.includes('还没有匹配记录')
    && emptyBody.includes('还没有优化记录') && emptyBody.includes('还没有面试记录'))

  check('   侧栏含 8 项且全部可用（未新增/未禁用菜单）',
    (await page.evaluate(`document.querySelectorAll('.sidebar__nav .el-menu-item').length`)) === 8,
    `菜单项数=${await page.evaluate(`document.querySelectorAll('.sidebar__nav .el-menu-item').length`)}`)
  await shot('01-dashboard-empty')

  // ============================================================== ② 快捷操作与 query 入口

  await clickQuickAction('上传简历')
  await page.waitFor(`location.pathname === '/resumes'`, { label: '跳转简历管理', timeout: 15000 })
  await page.waitFor(DIALOG_VISIBLE, { label: '上传弹窗自动打开', timeout: 10000 })
  check('② 「上传简历」跳简历管理并自动打开上传弹窗（?upload=1）',
    (await page.currentPath()).includes('upload=1')
    && (await page.textOf('.el-dialog__title')).includes('上传简历'),
    await page.currentPath())

  await page.goto(`${BASE}/dashboard`)
  await clickQuickAction('新建岗位匹配任务')
  await page.waitFor(`location.pathname === '/optimizations'`, { label: '跳转简历定向优化', timeout: 15000 })
  await page.waitFor(DIALOG_VISIBLE, { label: '新建优化弹窗自动打开', timeout: 10000 })
  check('   「新建岗位匹配任务」跳简历定向优化并自动打开新建弹窗（?create=1）',
    (await page.currentPath()).includes('create=1')
    && (await page.textOf('.el-dialog__title')).includes('新建简历优化'),
    await page.currentPath())

  await page.goto(`${BASE}/dashboard`)
  await clickQuickAction('开始 AI 面试')
  await page.waitFor(`location.pathname === '/interviews'`, { label: '跳转 AI 面试', timeout: 15000 })
  check('   「开始 AI 面试」跳 AI 面试列表', true, await page.currentPath())

  // ============================================================== ③ 造数据后回工作台核对

  const seeded = await seedAccountA()

  await page.goto(`${BASE}/dashboard`)
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '工作台重渲染', timeout: 20000 })
  await page.waitFor(`!!document.querySelector('.progress-row')`, { label: '工作流进度渲染', timeout: 20000 })
  // 统计卡恒定渲染（加载中也有节点）：必须等四个请求的数据落地，否则断言读到「加载中…」占位
  await page.waitFor(
    `![...document.querySelectorAll('.stat')].some((el) => el.textContent.includes('加载中'))`,
    { label: '统计卡数据落地', timeout: 20000 })
  await page.waitFor(`document.querySelectorAll('.recent-row').length >= 1`, { label: '最近记录渲染', timeout: 20000 })

  const cards = await cardTexts()
  check('③ 统计卡口径：简历 1 份 / 已分析岗位 0 个 / 匹配 0 次 / 面试 0 场',
    cards[0].includes('1份') && cards[1].includes('0个')
    && cards[2].includes('0次') && cards[3].includes('0场'),
    cards.join(' / '))
  check('   脚注指向下一步（简历待分析 / 岗位待分析 / 无匹配 / 无面试）',
    cards[0].includes('1 份待分析') && cards[1].includes('1 个待分析')
    && cards[2].includes('还没有匹配记录') && cards[3].includes('还没有面试记录'),
    cards.join(' / '))

  check('   工作流 1/5：仅「选择简历」完成（有简历即可）',
    (await page.textOf('.progress-row')).includes('已完成 1 / 5'),
    await page.textOf('.progress-row'))

  const resumeRows = await rowsIn('最近添加的简历')
  check('   「最近添加的简历」含本次上传的简历',
    resumeRows.some((row) => row.includes(RESUME_NAME)), resumeRows.join(' | '))

  const matchRows = await rowsIn('最近匹配的岗位')
  check('   「最近匹配的岗位」仍为空态（未做匹配）', matchRows.length === 0, `行数=${matchRows.length}`)

  const optimizationRows = await rowsIn('最近的简历优化任务')
  check('   「最近的简历优化任务」仍为空态', optimizationRows.length === 0, `行数=${optimizationRows.length}`)

  const interviewRows = await rowsIn('最近的 AI 面试记录')
  check('   「最近的 AI 面试记录」仍为空态', interviewRows.length === 0, `行数=${interviewRows.length}`)
  await shot('02-dashboard-seeded')

  // ============================================================== ④ 工作流选择与就地拦截

  await clickStepButton('选择简历', '选择简历')
  await page.waitFor(DIALOG_VISIBLE, { label: '选简历弹窗打开', timeout: 10000 })
  await page.waitFor(`!!document.querySelector('.el-dialog .picker .picker__item')`, { label: '简历列表加载', timeout: 20000 })
  await pickInDialog(RESUME_NAME)
  await sleep(300)
  check('④ 选简历弹窗内出现未分析提示（ResourcePicker 就地拦截）',
    (await page.textOf('.el-dialog .picker__block')).includes('还没有完成分析'),
    await page.textOf('.el-dialog .picker__block'))
  await clickDialogButton('完成')
  await sleep(300)

  await clickStepButton('选择岗位', '选择岗位')
  await page.waitFor(DIALOG_VISIBLE, { label: '选岗位弹窗打开', timeout: 10000 })
  await page.waitFor(`!!document.querySelector('.el-dialog .picker .picker__item')`, { label: '岗位列表加载', timeout: 20000 })
  await pickInDialog(JOB_NAME)
  await sleep(300)
  await clickDialogButton('完成')
  await sleep(300)

  const stepResume = await page.evaluate(
    `[...document.querySelectorAll('.step')].find((el) => el.querySelector('.step__title')?.textContent.trim() === '选择简历')?.innerText.replace(/\\n/g, ' ')`)
  check('   步骤①显示已选简历名与「未分析」标签',
    stepResume.includes(RESUME_NAME) && stepResume.includes('未分析'), stepResume)

  const notice = await page.textOf('.block-notice')
  check('   卡片给出拦截原因与修复入口（简历未分析）',
    notice.includes(RESUME_NAME) && notice.includes('还没有完成分析'), notice.replace(/\s+/g, ' '))

  const startDisabled = await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.run .el-button')]
      .find((el) => el.textContent.includes('开始匹配与优化'))
    return btn ? !!btn.disabled : true
  })()`)
  check('   「开始匹配与优化」按钮被禁用（前置条件未满足）', startDisabled === true)

  const stepJob = await page.evaluate(
    `[...document.querySelectorAll('.step')].find((el) => el.querySelector('.step__title')?.textContent.trim() === '选择岗位')?.innerText.replace(/\\n/g, ' ')`)
  check('   步骤②显示已选岗位名与「未分析」标签',
    stepJob.includes(JOB_NAME) && stepJob.includes('未分析'), stepJob)
  await shot('03-dashboard-blocked')

  // ============================================================== ⑤ 登录用户数据隔离

  await signIn(authB)
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '账号 B 工作台渲染', timeout: 20000 })
  await page.waitFor(`!!document.querySelector('.progress-row')`, { label: '账号 B 工作流渲染', timeout: 20000 })
  // summary 未回来前四卡显示「…」占位，必须等真实数字落地再断言
  await page.waitFor(
    `![...document.querySelectorAll('.stat')].some((el) => el.textContent.includes('加载中'))`,
    { label: '账号 B 统计卡加载完成', timeout: 20000 })

  const cardsB = await cardTexts()
  check('⑤ 账号 B 四卡全 0（看不到账号 A 的数据）',
    cardsB.length === 4 && cardsB.every((t) => /(^|\s)0[份个次场]/.test(t)),
    cardsB.join(' / '))

  const bodyB = await page.evaluate('document.body.innerText')
  check('   账号 B 的页面不含账号 A 的简历、岗位与公司名',
    !bodyB.includes(RESUME_NAME) && !bodyB.includes(JOB_NAME) && !bodyB.includes(COMPANY),
    '已确认无跨账号数据')

  const rowsB = await rowsIn('最近添加的简历')
  check('   账号 B「最近添加的简历」为空态', rowsB.length === 0, `行数=${rowsB.length}`)
  await shot('04-dashboard-other-user')

  // ============================================================== ⑥ 分区容错：单接口失败只影响对应区块

  await page.send('Network.enable')
  await page.send('Network.setBlockedURLs', { urls: ['*/api/interviews*'] })
  // 回到账号 A（有数据），才能验证「该区块报错、其余区块仍有数据」
  await signIn(authA)
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '统计卡仍渲染', timeout: 20000 })
  // summary 未被拦截，但同样要等真实数字落地再断言（统计卡恒定渲染，节点数量不蕴含数据就绪）
  await page.waitFor(
    `![...document.querySelectorAll('.stat')].some((el) => el.textContent.includes('加载中'))`,
    { label: '统计卡数据落地', timeout: 20000 })
  await page.waitFor(`document.body.innerText.includes('加载失败')`, { label: '区块错误态出现', timeout: 20000 })

  const brokenCards = await cardTexts()
  check('⑥ 面试接口失败时：统计卡照常渲染（分区容错，不整页报错）',
    brokenCards.length === 4 && brokenCards[0].includes('1份'), brokenCards.join(' / '))

  const interviewCard = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll('.el-card')].find(
      (c) => c.querySelector('.card__head h2')?.textContent.trim() === '最近的 AI 面试记录')
    return card ? card.innerText.replace(/\\n/g, ' ') : ''
  })()`)
  check('   面试区块给出可理解的错误与重试入口',
    interviewCard.includes('加载失败') && interviewCard.includes('重试'), interviewCard)

  const resumeRowsBroken = await rowsIn('最近添加的简历')
  check('   简历区块不受影响（仍显示自身数据）',
    resumeRowsBroken.some((row) => row.includes(RESUME_NAME)), resumeRowsBroken.join(' | '))
  await shot('05-dashboard-partial-error')

  await page.send('Network.setBlockedURLs', { urls: [] })

  // ============================================================== ⑦ 响应式

  await signIn(authA)
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '工作台渲染', timeout: 20000 })
  await page.waitFor(`!!document.querySelector('.progress-row')`, { label: '工作流进度渲染', timeout: 20000 })

  const cols = (selector) => page.evaluate(
    `getComputedStyle(document.querySelector('${selector}')).gridTemplateColumns.split(' ').length`)

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  check('⑦ ≤1100px：统计卡降为两列、最近记录堆叠为单列',
    (await cols('.stats')) === 2 && (await cols('.recents')) === 1,
    `stats=${await cols('.stats')} / recents=${await cols('.recents')}`)

  await page.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  check('   ≤768px：工作流步骤单列且页面无横向溢出',
    (await cols('.steps')) === 1
    && (await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')),
    `steps=${await cols('.steps')} / scrollWidth=${await page.evaluate('document.documentElement.scrollWidth')}`)
  await shot('06-dashboard-narrow')

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  // ============================================================== 汇总

  process.exitCode = summary() ? 0 : 1

  console.log('\n测试数据清理（后端无删除用户接口，需手工执行；表间有外键约束，须按依赖自底向上）：')
  console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id = ${authA.user?.id});`)
  console.log(`  DELETE FROM job_analysis WHERE job_id IN (SELECT id FROM job WHERE user_id = ${authA.user?.id});`)
  console.log(`  DELETE FROM resume WHERE user_id = ${authA.user?.id};`)
  console.log(`  DELETE FROM job WHERE user_id = ${authA.user?.id};`)
}
catch (error) {
  console.error(`\n❌ 脚本异常中断：${error.message}`)
  process.exitCode = 1
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}
