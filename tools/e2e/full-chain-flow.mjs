/**
 * M9 全链路端到端（主路径）：登录 → 仪表盘空态 → 改昵称 → 上传简历 → 分析
 * → 建岗位 → 分析 → 匹配 → 面试作答 → 智能体对话 → 回仪表盘核对。
 *
 * 作为**演示与回归的依据**（《开发顺序》M9 收尾任务 1）：一条脚本走通全部核心模块的
 * 真实浏览器操作与真实模型调用；末步回到仪表盘，核对四卡数字与本次流程产生的数据
 * 逐一一致、准备清单 6/6、最近匹配与能力差距与优化详情一致。
 *
 * 成本：**约 8–10 次真实模型调用**（简历分析 1 + 岗位分析 1 + 匹配解释 1
 *      + 面试出题 1 + 评价 2 + 总评 1 + 助手对话 1–2；分析/匹配皆为首次生成）。
 * 前置：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 * 与其它 e2e 脚本并行跑时用不同浏览器端口（本脚本默认 9225）。
 *
 * 用法：
 *   node tools/e2e/full-chain-flow.mjs
 *   node tools/e2e/full-chain-flow.mjs --shots ./tmp/shots-fullchain
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
const PORT = Number(argValue('port', '9225'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_full_${STAMP}`
const PASS = 'Test1234'
const NICKNAME = `全链路${String(STAMP).slice(-4)}`

/** 真实模型调用的等待上限（对话 1–3 轮 + 工具内部调用） */
const MODEL_TIMEOUT = 220000

const { check, summary } = createChecker()

const RESUME_NAME = `全链路简历${STAMP}`
const RESUME_TEXT = '姓名：王五。本科，计算机科学与技术。技能：Java、Spring Boot、MySQL、Redis。'
  + '项目经历：校园订餐系统后端开发，负责订单、支付与库存模块，使用 Spring Boot + MySQL 实现。'

const COMPANY = '全链路科技'
const JOB_NAME = 'Java 后端开发（全链路演示）'
const JOB_DESC = '岗位职责：\n1. 参与核心业务系统的后端开发，负责接口设计与实现；\n2. 配合前端完成联调。\n\n'
  + '任职要求：\n1. 熟悉 Java 基础与 Spring Boot 框架；\n2. 熟悉 MySQL 索引与常见优化手段；\n'
  + '3. 了解 Redis 缓存的基本使用；\n4. 有 Docker 部署经验者优先。'

const ANSWER_1 = '我会用 Spring Boot 的 @Transactional 注解控制事务，注意事务边界不包住远程调用；'
  + 'MySQL 索引遵循最左前缀原则，用 explain 分析慢查询。项目里做过订单模块的接口与索引优化。'
const ANSWER_2 = 'Redis 我主要用在缓存热点数据，采用旁路缓存模式，设置合理的过期时间避免雪崩；'
  + '对一致性要求高的场景会先更新数据库再删除缓存。'
const AGENT_QUESTION = '帮我分析一下我的简历'

// ---------------------------------------------------------------- 准备测试账号

console.log(`前置检查：后端 ${API} / 前端 ${BASE}\n`)

const login = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, email: `${USER}@example.com`, password: PASS }),
}).then((r) => r.json()).catch((error) => ({ message: error.message }))

if (login.code !== 0) {
  console.error(`❌ 无法创建测试账号（后端未启动？）：${login.message || JSON.stringify(login)}`)
  process.exit(1)
}
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: USER, password: PASS }),
}).then((r) => r.json())
const TOKEN = loginRes.data.token
const USER_ID = loginRes.data.user?.id

console.log(`已创建测试账号 ${USER}（id=${USER_ID}）\n`)

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

const DIALOG_VISIBLE = `(() => {
  const el = document.querySelector('.el-dialog')
  return !!el && el.offsetParent !== null
})()`

const MESSAGE_BOX_VISIBLE = `(() => {
  const el = document.querySelector('.el-message-box')
  return !!el && el.offsetParent !== null
})()`

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

const clickItemButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.item .el-button')]
    .find((el) => el.textContent.trim() === '${text}')
  if (!btn) throw new Error('找不到列表按钮：${text}')
  btn.click()
  return true
})()`)

const clickMessageBoxConfirm = () => page.evaluate(`(() => {
  const btn = document.querySelector('.el-message-box__btns .el-button--primary')
  if (!btn) throw new Error('找不到确认按钮')
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

/** 在指定的资源选择器（0 简历 / 1 岗位）中按名称选中一项 */
const pickByName = (pickerIndex, name) => page.evaluate(`(() => {
  const picker = document.querySelectorAll('.el-dialog .picker')[${pickerIndex}]
  if (!picker) throw new Error('找不到资源选择器 #${pickerIndex}')
  const item = [...picker.querySelectorAll('.picker__item')]
    .find((el) => el.textContent.includes(${JSON.stringify(name)}))
  if (!item) throw new Error('找不到资源：' + ${JSON.stringify(name)})
  item.querySelector('.picker__radio').click()
  return true
})()`)

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

/** 四张统计卡的文本（换行折叠为空格） */
const cardTexts = () => page.evaluate(
  `[...document.querySelectorAll('.stat')].map((el) => el.innerText.replace(/\\n/g, ' '))`)

/** 列表行文本 */
const itemTexts = () => page.evaluate(
  `[...document.querySelectorAll('.item')].map((el) => el.innerText.replace(/\\n/g, ' '))`)

/** 等待简历/岗位列表页渲染出可操作的行 */
const waitItemButtons = () => page.waitFor(
  `[...document.querySelectorAll('.item .el-button')].some((el) => el.textContent.trim() === '发起分析')`,
  { label: '列表项渲染完成', timeout: 20000 })

/* ---------------------------------------------------------------- 答题页操作（每步校验确切中间态） */

/**
 * 提交当前题。**先校验按钮可用**：评价进行中按钮为 disabled（`evaluatingQuestionId !== null`），
 * 此时 `click()` 会被吞掉、请求不发出——必须显式报错而不是静默走偏。
 */
const submitAnswer = async () => {
  const disabled = await page.evaluate(
    `document.querySelector('.answer-block__actions .el-button')?.disabled ?? true`)
  if (disabled) {
    throw new Error('提交按钮当前为禁用（评价进行中），无法提交')
  }
  await page.evaluate(`document.querySelectorAll('.answer-block__actions .el-button')[0].click()`)
}

/** 等「正在批改」等待态出现（证明提交已发出） */
const waitReviewing = () => page.waitFor(
  `document.querySelector('.ai-waiting__title')?.textContent?.includes('正在批改') === true`,
  { label: '评价等待态出现', timeout: 15000 })

/** 等评价完成（分数渲染） */
const waitReviewDone = () => page.waitFor(
  `document.querySelector('.review__num') !== null`,
  { label: '评价结果渲染', timeout: MODEL_TIMEOUT })

/**
 * 切到第 index 题（0 起）并**确认切换生效**：评价进行中 `goto()` 会静默忽略点击，
 * 只发一次点击就继续会让后续 fill/提交全部落在旧题上（agent 侧踩过同类竞态）。
 */
const gotoQuestion = async (index) => {
  const expected = `第 ${index + 1} 题`
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(`document.querySelectorAll('.nav__item')[${index}].click()`)
    await sleep(600)
    const title = await page.evaluate(`document.querySelector('.question-card h2')?.textContent?.trim()`)
    if (title === expected) {
      return
    }
  }
  throw new Error(`无法切换到${expected}（题号导航点击被忽略？）`)
}

/** 走一遍「发起分析 → 确认 → 等待态 → 完成」（简历与岗位两页同构） */
async function runAnalysis(pageName, resultLabel) {
  await clickItemButton('发起分析')
  await page.waitFor(`location.pathname.includes('/analysis')`, { label: `跳转${pageName}分析页`, timeout: 15000 })
  check(`   点击「发起分析」跳转${pageName}分析页并带 auto=1`,
    (await page.currentPath()).includes('auto=1'), await page.currentPath())

  await page.waitFor(MESSAGE_BOX_VISIBLE, { label: '自动弹出确认框', timeout: 15000 })
  await clickMessageBoxConfirm()
  await page.waitFor(`!!document.querySelector('.ai-waiting')`, { label: '等待态出现', timeout: 10000 })
  check(`   ${pageName}分析进入 AiWaiting 等待态`,
    (await page.textOf('.ai-waiting')).includes('秒'), (await page.textOf('.ai-waiting')).replace(/\s+/g, ' ').slice(0, 40))

  await page.waitFor(`document.querySelector('.ai-waiting') === null`, { label: `${pageName}分析完成`, timeout: MODEL_TIMEOUT })
  await page.waitFor(
    `[...document.querySelectorAll('.page-head .el-tag')].some((e) => e.textContent.includes('已分析'))`,
    { label: '页头标签变为已分析', timeout: 15000 })
  check(`   ${resultLabel}，页头标签变为「已分析」`, true)
}

// ---------------------------------------------------------------- 主流程

try {
  // ============================================================== ① 登录并落地仪表盘（空态）

  await page.goto(`${BASE}/dashboard`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/dashboard`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向到登录页', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '登录后落地仪表盘', timeout: 20000 })
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '统计卡渲染', timeout: 20000 })

  const emptyCards = await cardTexts()
  check('① 新账号落地仪表盘：四卡计数全 0',
    emptyCards.length === 4 && emptyCards.every((t) => /(^|\s)0[份个次场]/.test(t)),
    emptyCards.join(' / '))
  check('   准备清单 0/6（六步全部由计数字段推导）',
    (await page.textOf('.progress-row')).includes('已完成 0 / 6'),
    await page.textOf('.progress-row'))
  check('   两个列表区块为空态引导文案',
    (await page.evaluate(`document.body.innerText`)).includes('还没有匹配记录'))
  await shot('01-dashboard-empty')

  // ============================================================== ② 修改昵称（/profile）

  await page.goto(`${BASE}/profile`)
  await page.waitFor(`document.querySelector('.icon-btn')`, { label: '个人中心渲染', timeout: 20000 })
  await page.evaluate(`document.querySelector('.icon-btn').click()`)
  await page.waitFor(`!!document.querySelector('.card .el-form')`, { label: '进入编辑态', timeout: 10000 })
  await page.fill(0, NICKNAME)
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-button')]
      .find((el) => el.textContent.trim() === '保存修改' && el.offsetParent !== null)
    if (!btn) throw new Error('找不到保存按钮')
    btn.click()
    return true
  })()`)
  await sleep(1000)

  const profileText = await page.evaluate('document.body.innerText')
  const storedNickname = await page.evaluate(`JSON.parse(localStorage.getItem('user') || '{}').nickname`)
  check('② 昵称修改后顶栏即时同步、本地存储已更新',
    profileText.includes(NICKNAME) && storedNickname === NICKNAME,
    `页面含=${profileText.includes(NICKNAME)} 存储=${storedNickname}`)
  await shot('02-profile-saved')

  // ============================================================== ③ 上传简历（/resumes）

  await page.goto(`${BASE}/resumes`)
  await page.waitFor(`document.querySelector('.page-head h1')?.textContent?.trim() === '简历管理'`,
    { label: '简历页渲染完成', timeout: 20000 })
  await clickPageHeadButton('上传简历')
  await page.waitFor(`(() => { const el = document.querySelector('.el-dialog .el-upload-dragger'); return !!el && el.offsetParent !== null })()`,
    { label: '上传弹窗打开' })
  await page.fill(0, RESUME_NAME)
  await injectFile({ data: buildTxt(RESUME_TEXT), name: `${RESUME_NAME}.txt`, type: 'text/plain' })
  await clickDialogButton('开始上传')
  await page.waitFor(`document.querySelectorAll('.item').length === 1`, { label: '列表出现新简历', timeout: 30000 })
  await page.waitFor(`document.querySelector('.item .el-tag')?.textContent?.trim() === '未分析'`,
    { label: '新简历标签为未分析', timeout: 15000 })
  check('③ 上传 TXT 简历成功，列表显示「未分析」',
    (await itemTexts())[0].includes(RESUME_NAME), (await itemTexts())[0].slice(0, 60))
  await shot('03-resume-uploaded')

  // ============================================================== ④ 简历分析

  await runAnalysis('简历', '简历 AI 分析完成并渲染结果')
  await shot('04-analysis-done')

  // ============================================================== ⑤ 创建岗位（/jobs）

  await page.goto(`${BASE}/jobs`)
  await page.waitFor(`document.querySelector('.page-head h1')?.textContent?.trim() === '岗位管理'`,
    { label: '岗位页渲染完成', timeout: 20000 })
  await clickPageHeadButton('新建岗位')
  await page.waitFor(DIALOG_VISIBLE, { label: '新建弹窗打开' })
  await page.fill(0, COMPANY)
  await page.fill(1, JOB_NAME)
  await page.fill(0, JOB_DESC, '.el-dialog .el-textarea__inner')
  await clickDialogButton('保存')
  await page.waitFor(`document.querySelectorAll('.item').length === 1`, { label: '列表出现新岗位', timeout: 20000 })
  await page.waitFor(`document.querySelector('.item .el-tag')?.textContent?.trim() === '未分析'`,
    { label: '新岗位标签为未分析', timeout: 15000 })
  check('⑤ 新建岗位成功，列表显示「未分析」',
    (await itemTexts())[0].includes(JOB_NAME), (await itemTexts())[0].slice(0, 60))
  await shot('05-job-created')

  // ============================================================== ⑥ 岗位分析

  await runAnalysis('岗位', '岗位 AI 分析完成并渲染结果')
  await shot('06-job-analyzed')

  // ============================================================== ⑦ 简历定向优化（/optimizations）→ 工作台

  await page.goto(`${BASE}/optimizations`)
  await page.waitFor(`document.querySelector('.page-head h1')?.textContent?.trim() === '简历定向优化'`,
    { label: '优化页渲染完成', timeout: 20000 })
  await clickPageHeadButton('新建简历优化')
  await page.waitFor(DIALOG_VISIBLE, { label: '新建弹窗打开' })
  await page.waitFor(`document.querySelectorAll('.el-dialog .picker__item').length >= 2`,
    { label: '两个资源选择器加载完成', timeout: 20000 })
  await pickByName(0, RESUME_NAME)
  await pickByName(1, JOB_NAME)
  await sleep(400)
  await clickDialogButton('开始优化')
  await page.waitFor(`/^\\/optimizations\\/\\d+$/.test(location.pathname)`, { label: '优化完成后跳转工作台', timeout: MODEL_TIMEOUT })
  await page.waitFor(`!!document.querySelector('.score-ring__num')`, { label: '工作台渲染', timeout: 20000 })

  const ringScore = parseFloat(await page.textOf('.score-ring__num'))
  const optimizationId = Number((await page.evaluate('location.pathname')).split('/').pop())
  check('⑦ 优化完成，工作台优化前分数环渲染出分数', Number.isFinite(ringScore), `分数=${ringScore}`)
  await shot('07-optimization-workbench')

  // 记录优化详情（供末步与仪表盘 topGaps 比对；用接口读，避免依赖页面结构。
  // 优化流程内部会写一条 match_record 作为"优化前匹配评估"，仪表盘的统计与差距即来自它）
  const matchDetail = (await fetch(`${API}/optimizations/${optimizationId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }).then((r) => r.json())).data
  check('   优化前总分与分数环一致（同一数据源）',
    Math.abs(ringScore - matchDetail.matchScore) < 1e-9,
    `页面=${ringScore} 接口=${matchDetail.matchScore}`)

  // ============================================================== ⑧ 面试（2 题，全部作答）

  await page.goto(`${BASE}/interviews`)
  await page.waitFor(`document.querySelector('.page-head h1')?.textContent?.trim() === 'AI 面试'`,
    { label: '面试页渲染完成', timeout: 20000 })
  await clickPageHeadButton('新建模拟面试')
  await page.waitFor(DIALOG_VISIBLE, { label: '创建弹窗打开' })
  await page.evaluate(`(() => {
    const radios = [...document.querySelectorAll('.el-dialog .el-radio-button')]
    const java = radios.find((el) => el.textContent.trim() === 'Java 基础')
    if (!java) throw new Error('找不到题型选项')
    java.click()
    return true
  })()`)
  await selectDialogOption(JOB_NAME)
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
  check('⑧ 创建面试会话（2 题）并进入答题页', countValue === '2', `题数=${countValue}`)

  await clickDialogButton('生成题目')
  await page.waitFor(`/^\\/interviews\\/\\d+$/.test(location.pathname)`, { label: '出题完成跳转答题页', timeout: MODEL_TIMEOUT })
  await page.waitFor(
    `document.querySelector('.question-card__text') !== null
     && document.querySelector('.answer-block .el-textarea__inner') !== null`,
    { label: '答题页渲染完成', timeout: 20000 })

  // 第 1 题：提交 → 等待态（证明已发出）→ 评价结果
  await page.fill(0, ANSWER_1, '.answer-block .el-textarea__inner')
  await submitAnswer()
  await waitReviewing()
  await waitReviewDone()

  // 第 2 题：经题号导航切换（切换后校验确实到了第 2 题）
  await gotoQuestion(1)
  await page.fill(0, ANSWER_2, '.answer-block .el-textarea__inner')
  await submitAnswer()
  await waitReviewing()
  await waitReviewDone()
  await page.waitFor(
    `[...document.querySelectorAll('.el-message')].some((e) => e.textContent.includes('全部题目已作答'))`,
    { label: '全部作答提示', timeout: 30000 }).catch(() => {})
  check('   两题作答完成，逐题评价渲染（含总分与总评生成）', true)
  await shot('08-interview-done')

  // ============================================================== ⑨ 智能体对话（/agent）

  await page.goto(`${BASE}/agent`)
  await page.waitFor(`document.querySelector('.empty__title') || document.querySelector('.side__new')`,
    { label: '智能体页渲染', timeout: 20000 })
  await page.fill(0, AGENT_QUESTION, '.el-textarea__inner')
  await page.evaluate(`document.querySelector('.composer__send').click()`)
  await page.waitFor(`document.querySelector('.msg--assistant .msg__text') !== null`,
    { label: '助手回复出现', timeout: MODEL_TIMEOUT })
  const agentAnswer = await page.textOf('.msg--assistant .msg__text')
  check('⑨ 智能体对话返回助手回复', agentAnswer.length > 0, agentAnswer.replace(/\s+/g, ' ').slice(0, 60))
  await shot('09-agent-answer')

  // ============================================================== ⑩ 回仪表盘核对（终局一致性）

  await page.goto(`${BASE}/dashboard`)
  await page.waitFor(`document.querySelectorAll('.stat').length === 4`, { label: '仪表盘渲染', timeout: 20000 })
  await page.waitFor(`document.querySelectorAll('.match-row').length >= 1`, { label: '最近匹配渲染', timeout: 20000 })

  const finalCards = await cardTexts()
  check('⑩ 四卡数字与本次流程产生的数据一致（1 简历 / 1 岗位 / 1 匹配 / 1 面试）',
    finalCards[0].includes('1份') && finalCards[1].includes('1个')
    && finalCards[2].includes('1次') && finalCards[3].includes('1场'),
    finalCards.join(' / '))
  check('   脚注同步（简历 1 份已分析 / 岗位 1 个已分析 / 最高分 = 报告分数 / 面试 1 场已完成）',
    finalCards[0].includes('1 份已完成 AI 分析') && finalCards[1].includes('1 个已完成 AI 分析')
    && finalCards[2].includes(`最高匹配分 ${matchDetail.matchScore}`) && finalCards[3].includes('1 场已完成'),
    finalCards.join(' / '))
  check('   准备清单 6/6（100%）',
    (await page.textOf('.progress-row')).includes('已完成 6 / 6')
    && (await page.textOf('.progress-row')).includes('100%'),
    await page.textOf('.progress-row'))

  const matchRows = await page.evaluate(
    `[...document.querySelectorAll('.match-row')].map((el) => el.innerText.replace(/\\n/g, ' '))`)
  check('   最近匹配记录 1 行：含岗位名、简历名与报告分数',
    matchRows.length === 1 && matchRows[0].includes(JOB_NAME) && matchRows[0].includes(RESUME_NAME)
    && matchRows[0].includes(String(matchDetail.matchScore)),
    matchRows.join(' | '))

  // 能力差距概览与报告明细逐条一致（missing 在前、partial 在后、最多 3 条）
  const expectedGaps = [
    ...(matchDetail.missingItems ?? []),
    ...(matchDetail.partialItems ?? []),
  ].slice(0, 3)
  const gapTexts = await page.evaluate(
    `[...document.querySelectorAll('.gap-item')].map((el) => el.innerText.replace(/\\n/g, ' '))`)
  check('   能力差距概览与报告明细一致（条数与顺序：missing 在前）',
    gapTexts.length === expectedGaps.length
    && expectedGaps.every((gap, index) => gapTexts[index].includes(gap.text.slice(0, 20))),
    `页面 ${gapTexts.length} 条 / 报告前 ${expectedGaps.length} 条`)
  await shot('10-dashboard-complete')

  // ============================================================== 汇总

  // summary() 返回布尔（true = 全部通过），并由它打印汇总行
  process.exitCode = summary() ? 0 : 1

  // ------------------------------------------------------------- 清理提示

  const uid = USER_ID ?? '<uid>'
  console.log('\n测试数据清理（后端无删除用户接口，需手工执行；表间有外键约束，须按依赖自底向上）：')
  console.log(`  DELETE FROM agent_chat_message WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM agent_session WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM interview_question WHERE session_id IN (SELECT id FROM interview_session WHERE user_id = ${uid});`)
  console.log(`  DELETE FROM interview_session WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM resume_optimization WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM match_record WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM job_analysis WHERE job_id IN (SELECT id FROM job WHERE user_id = ${uid});`)
  console.log(`  DELETE FROM job WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id = ${uid});`)
  console.log(`  DELETE FROM resume WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM sys_user WHERE id = ${uid};`)
  console.log(`  -- 物理文件目录：~/career-pilot-uploads/${uid}/`)
  if (SHOTS) {
    console.log(`截图目录：${SHOTS}`)
  }
}
catch (error) {
  console.error(`\n❌ 脚本异常：${error.message}`)
  process.exitCode = 1
}
finally {
  page.close()
  await closeBrowser(PORT, { proc: browser.proc, profileDir: browser.profileDir }).catch(() => {})
}
