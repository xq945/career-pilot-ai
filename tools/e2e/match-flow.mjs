/**
 * 匹配模块端到端验证（真实浏览器 + 真实模型调用）。
 *
 * 覆盖《开发顺序》M6 的验收标准与《前端原型设计》§5.7／§5.8 的页面行为：
 * 空态、新建匹配弹窗的**两个就地拦截**（未分析 / 分析已过期，且**不发出请求**）、
 * 正常匹配的等待态与报告页渲染（分数环数值等于接口分数、维度条与接口权重一致、
 * 三栏明细、差距区块免责声明）、列表倒序与「同一组合再次匹配产生两条记录」、
 * 删除简历后名称仍显示、报告仍可打开。
 *
 * 接口层（分数自洽、失败矩阵、50200）由 tools/verify/m6-match-api.mjs 与
 * m6-ai-timeout.mjs 验证，本脚本只补浏览器独有的部分。
 *
 * **本脚本会消耗真实模型 token（2 次分析 + 2 次匹配解释）。**
 *
 * 前置条件：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/match-flow.mjs
 *   node tools/e2e/match-flow.mjs --shots ./tmp/shots-match
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
const USER = `e2e_match_${STAMP}`
const PASS = 'Test1234'

/** 真实模型调用的等待上限（匹配解释通常 5–20 秒，分析 10–30 秒） */
const AI_TIMEOUT = 120000

const { check, summary } = createChecker()

const COMPANY = '示例科技'
const JOB_NAME = 'Java 后端开发实习生'
const JOB_RAW_NAME = '未分析岗位'
const RESUME_NAME = '匹配验收简历'
const RESUME_RAW_NAME = '未分析简历'

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

// ---------------------------------------------------------------- 接口辅助（数据准备与断言用）

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

const matchTotal = async (token) =>
  (await api('GET', '/matches?page=1&size=10', { token })).body?.data?.total

// ---------------------------------------------------------------- 准备测试数据（API）

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

const jobAId = (await api('POST', '/jobs', {
  token: TOKEN,
  body: { jobName: JOB_NAME, companyName: COMPANY, description: DESC },
})).body?.data?.id
const jobBId = (await api('POST', '/jobs', {
  token: TOKEN,
  body: { jobName: JOB_RAW_NAME, description: 'Java 后端方向，要求熟悉 Java。' },
})).body?.data?.id
const resumeMainId = await uploadResume(TOKEN, RESUME_NAME)
const resumeRawId = await uploadResume(TOKEN, RESUME_RAW_NAME)

const jobAnalysis = await api('POST', `/jobs/${jobAId}/analyze`, { token: TOKEN })
const resumeAnalysis = await api('POST', `/resumes/${resumeMainId}/analyze`, { token: TOKEN })
if (jobAnalysis.body?.code !== 0 || resumeAnalysis.body?.code !== 0) {
  console.error('❌ 预置分析失败，无法继续：'
    + `岗位 code=${jobAnalysis.body?.code} 简历 code=${resumeAnalysis.body?.code}`)
  process.exit(1)
}
console.log('已预置：2 个岗位（1 已分析 / 1 未分析）+ 2 份简历（1 已分析 / 1 未分析）\n')

// ---------------------------------------------------------------- 启动浏览器

const browser = await launchBrowser({ port: PORT })
const page = await connect({ port: PORT })
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})

/** 截图前先等标签进入动画结束（见 tools/e2e/README.md 的坑清单） */
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

/** 点击页头按钮（按文案） */
const clickPageHeadButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.page-head .el-button')]
    .find((el) => el.textContent.includes('${text}'))
  if (!btn) throw new Error('找不到页头按钮：${text}')
  btn.click()
  return true
})()`)

/** 弹窗是否可见（v-show + DOM 常驻，必须看可见性而不是是否存在） */
const DIALOG_VISIBLE = `(() => {
  const el = document.querySelector('.el-dialog')
  return !!el && el.offsetParent !== null
})()`

/** 点击弹窗底部按钮（按文案） */
const clickDialogButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.trim() === '${text}')
  if (!btn) throw new Error('找不到弹窗按钮：${text}')
  btn.click()
  return true
})()`)

/** 提交按钮是否禁用（「开始匹配」） */
const submitDisabled = () => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.trim() === '开始匹配')
  if (!btn) throw new Error('找不到「开始匹配」按钮')
  return btn.disabled
})()`)

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

/** 指定选择器当前的拦截提示文本（无提示返回空串） */
const blockText = (pickerIndex) => page.evaluate(`(() => {
  const picker = document.querySelectorAll('.el-dialog .picker')[${pickerIndex}]
  const el = picker?.querySelector('.picker__block')
  return el ? el.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`)

/** 等待匹配列表页渲染完成 */
const waitMatchesReady = () => page.waitFor(
  `document.querySelector('.page-head h1')?.textContent?.trim() === '岗位匹配'`,
  { label: '匹配页渲染完成', timeout: 20000 })

/** 等待报告页渲染完成 */
const waitReportReady = () => page.waitFor(
  `document.querySelector('.page-head h1')?.textContent?.trim() === '匹配报告'`,
  { label: '报告页渲染完成', timeout: 20000 })

try {
  // ------------------------------------------------------------ ① 登录并进入匹配页（空态）

  await page.goto(`${BASE}/matches`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/matches`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向到登录页', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/matches'`, { label: '登录后回跳匹配页', timeout: 20000 })
  await waitMatchesReady()

  await page.waitFor(`!!document.querySelector('.state__title')`, { label: '空态渲染', timeout: 15000 })
  const emptyText = await page.textOf('.state')
  check('① 空态：文案说明用途并有「新建匹配分析」入口',
    emptyText.includes('还没有匹配记录') && emptyText.includes('五个维度'),
    emptyText.replace(/\s+/g, ' ').slice(0, 60))
  await shot('01-matches-empty')

  // ------------------------------------------------------------ ② 弹窗：未分析资源的两处就地拦截

  await clickPageHeadButton('新建匹配分析')
  await page.waitFor(DIALOG_VISIBLE, { label: '新建弹窗打开' })
  await page.waitFor(
    `document.querySelectorAll('.el-dialog .picker__item').length >= 4`,
    { label: '两个资源选择器加载完成', timeout: 20000 })

  const totalBefore = await matchTotal(TOKEN)
  check('   弹窗内提交按钮初始为禁用（尚未选择双方）', await submitDisabled())

  // 选中未分析的简历 → 简历侧拦截
  await pickByName(0, RESUME_RAW_NAME)
  await page.waitFor(`!!document.querySelectorAll('.el-dialog .picker')[0].querySelector('.picker__block')`,
    { label: '简历侧拦截提示出现', timeout: 10000 })
  const resumeBlock = await blockText(0)
  check('② 选中未分析简历 → 就地拦截（文案含「还没有完成分析」与「立即分析」）',
    resumeBlock.includes('还没有完成分析') && resumeBlock.includes('立即分析'), resumeBlock.slice(0, 80))
  check('   拦截时提交按钮禁用', await submitDisabled())

  // 再选未分析的岗位 → 岗位侧拦截
  await pickByName(1, JOB_RAW_NAME)
  await page.waitFor(`!!document.querySelectorAll('.el-dialog .picker')[1].querySelector('.picker__block')`,
    { label: '岗位侧拦截提示出现', timeout: 10000 })
  const jobBlock = await blockText(1)
  check('   选中未分析岗位 → 岗位侧同样就地拦截',
    jobBlock.includes('还没有完成分析'), jobBlock.slice(0, 80))
  await shot('02-dialog-blocked')

  // 换成已分析的双方 → 拦截消失、可以提交
  await pickByName(0, RESUME_NAME)
  await pickByName(1, JOB_NAME)
  await sleep(400)
  const clearedBlocks = (await blockText(0)) === '' && (await blockText(1)) === ''
  check('   换成已分析的双方后拦截消失、提交可用',
    clearedBlocks && !(await submitDisabled()))

  // ------------------------------------------------------------ ③ 正常匹配 → 等待态 → 报告页

  await clickDialogButton('开始匹配')
  await page.waitFor(`!!document.querySelector('.el-dialog .ai-waiting')`,
    { label: '弹窗内等待态出现', timeout: 15000 })
  const waitingText = await page.textOf('.el-dialog .ai-waiting')
  check('③ 提交后弹窗内出现 AiWaiting 等待态（匹配版文案）',
    waitingText.includes('AI 正在生成匹配报告') && waitingText.includes('后端按固定权重计算'),
    waitingText.replace(/\s+/g, ' ').slice(0, 60))
  await shot('03-matching')

  console.log(`   等待真实模型生成匹配报告（最长 ${AI_TIMEOUT / 1000} 秒）…`)
  await page.waitFor(`location.pathname.startsWith('/matches/')`,
    { label: '成功后跳转报告页', timeout: AI_TIMEOUT })
  await waitReportReady()
  await page.waitFor(`!!document.querySelector('.score-ring__num')`, { label: '报告渲染', timeout: 20000 })

  const matchId = Number((await page.currentPath()).match(/\/matches\/(\d+)/)[1])
  const matchDetail = (await api('GET', `/matches/${matchId}`, { token: TOKEN })).body?.data

  // 分数环数值 == 接口分数
  const ringScore = parseFloat(await page.textOf('.score-ring__num'))
  check('④ 报告页分数环数值等于接口返回的 matchScore',
    Math.abs(ringScore - matchDetail.matchScore) < 1e-9,
    `页面=${ringScore} 接口=${matchDetail.matchScore}`)

  // 维度条：5 条、权重文案与接口 items 一一对应（且顺序一致）
  const bars = await page.evaluate(
    `[...document.querySelectorAll('.dim')].map((el) => ({
       label: el.querySelector('.dim__label')?.innerText.replace(/\\s+/g, ' ').trim(),
       value: el.querySelector('.dim__value')?.textContent.trim(),
     }))`)
  const items = matchDetail.dimensionScores.items
  check('   维度条 5 条且顺序与接口 items 一致',
    bars.length === 5 && bars.every((bar, i) => bar.label.includes(items[i].label)),
    bars.map((b) => b.label).join(' | '))
  check('   每条权重取自接口（未硬编码）',
    bars.every((bar, i) => bar.label.includes(`权重 ${items[i].weight}%`)
      && Number(bar.value) === items[i].score),
    bars.map((b) => b.label).join(' | '))

  // 三栏明细与差距区块
  const detailCounts = await page.evaluate(
    `[...document.querySelectorAll('.detail-col')].map((el) => el.querySelectorAll('.detail-item').length)`)
  check('   三栏明细渲染（已匹配/部分匹配/未体现，条数与接口一致）',
    detailCounts.length === 3
    && detailCounts[0] === (matchDetail.matchedItems ?? []).length
    && detailCounts[2] === (matchDetail.missingItems ?? []).length,
    detailCounts.join('/'))

  const gapText = await page.textOf('.gap__note')
  check('   能力差距区块有免责说明（信息缺口不代表不具备该能力）',
    gapText.includes('信息缺口') && gapText.includes('不代表你不具备该能力'),
    gapText.replace(/\s+/g, ' ').slice(0, 70))

  // 措辞检查只针对**模型产出的内容**：免责声明本身含「不代表你不具备该能力」，
  // 那是《前端原型设计》§5.8 要求的合规文案，不能算作违规（接口层验收另有 JSON 级断言）
  const generatedText = await page.evaluate(`[
    ...document.querySelectorAll('.detail-item__text'),
    ...document.querySelectorAll('.gap-item__text'),
    ...document.querySelectorAll('.suggestions li'),
    ...document.querySelectorAll('.card__foot'),
  ].map((el) => el.textContent.trim()).join('\\n')`)
  check('   模型生成的明细、总评与建议不含「不具备」类断言',
    !generatedText.includes('不具备'), generatedText.slice(0, 80))

  const basisText = await page.textOf('.layout__side')
  check('   右栏「本次匹配依据」含双方版本号与评分规则',
    basisText.includes('v1') && basisText.includes(matchDetail.dimensionScores.ruleVersion),
    basisText.replace(/\s+/g, ' ').slice(0, 80))
  check('   改进建议按有序列表渲染',
    (matchDetail.suggestions ?? []).length === await page.evaluate(`document.querySelectorAll('.suggestions li').length`))
  await shot('04-report')

  // ------------------------------------------------------------ ⑤ 列表：倒序与新记录

  await page.goto(`${BASE}/matches`)
  await waitMatchesReady()
  await page.waitFor(`document.querySelectorAll('.item').length === 1`, { label: '列表 1 条', timeout: 15000 })
  const firstMeta = await page.textOf('.item__meta')
  check('⑤ 列表展示岗位+公司、使用简历与分析版本、时间',
    firstMeta.includes(COMPANY) && firstMeta.includes(`使用「${RESUME_NAME}」v1`) && firstMeta.includes(JOB_NAME),
    firstMeta.replace(/\s+/g, ' ').slice(0, 80))
  const scoreTag = await page.textOf('.item .el-tag')
  check('   匹配分标签与接口分数一致（去掉尾零展示）',
    Number(scoreTag) === Number(matchDetail.matchScore), `${scoreTag} vs ${matchDetail.matchScore}`)

  // 同一组合再次匹配（接口发起，等价于 UI 再次走一遍弹窗流程）——产生第二条记录
  const second = await api('POST', '/matches', { token: TOKEN, body: { resumeId: resumeMainId, jobId: jobAId } })
  check('   同一组合重复匹配产生新记录（id 不同）',
    second.body?.code === 0 && second.body?.data?.id !== matchId,
    `${matchId} vs ${second.body?.data?.id}`)

  await page.reload()
  await waitMatchesReady()
  await page.waitFor(`document.querySelectorAll('.item').length === 2`, { label: '列表 2 条', timeout: 15000 })
  const metas = await page.evaluate(
    `[...document.querySelectorAll('.item__meta')].map((el) => el.textContent.trim())`)
  const times = metas.map((text) => text.slice(-16))
  check('   列表按时间倒序渲染（第一行时间不早于第二行，且共 2 条）',
    metas.length === 2 && times[0] >= times[1] && (await matchTotal(TOKEN)) === 2,
    times.join(' | '))
  await shot('05-list-two')

  // ------------------------------------------------------------ ⑥ 岗位分析过期 → 弹窗内拦截、不发出请求

  await api('PUT', `/jobs/${jobAId}`, {
    token: TOKEN,
    body: { jobName: JOB_NAME, companyName: COMPANY, description: `${DESC}\n\n补充：熟悉 Linux 者优先。` },
  })
  const totalBeforeStale = await matchTotal(TOKEN)

  await clickPageHeadButton('新建匹配分析')
  await page.waitFor(DIALOG_VISIBLE, { label: '弹窗重新打开' })
  await page.waitFor(
    `document.querySelectorAll('.el-dialog .picker__item').length >= 4`,
    { label: '资源选择器加载完成', timeout: 20000 })
  await pickByName(0, RESUME_NAME)
  await pickByName(1, JOB_NAME)

  await page.waitFor(`!!document.querySelectorAll('.el-dialog .picker')[1].querySelector('.picker__block')`,
    { label: '过期拦截提示出现', timeout: 10000 })
  const staleBlock = await blockText(1)
  check('⑥ 岗位描述更新后选该岗位 → 弹窗内过期拦截（文案指向先重新分析）',
    staleBlock.includes('分析已过期') && staleBlock.includes('重新分析'), staleBlock.slice(0, 90))
  check('   过期拦截时提交按钮禁用', await submitDisabled())

  // 断言「未发出请求」：等待若干秒后记录数不变（拦截即阻断，不存在隐式的后备提交）
  await sleep(1200)
  check('   拦截后未产生任何匹配记录（total 不变）',
    (await matchTotal(TOKEN)) === totalBeforeStale, `${totalBeforeStale}`)
  await shot('06-stale-blocked')

  // 关闭弹窗（避免遮挡后续断言）
  await clickDialogButton('取消')
  await sleep(400)

  // ------------------------------------------------------------ ⑦ 删除简历：列表名称仍在、报告仍可打开

  await api('DELETE', `/resumes/${resumeMainId}`, { token: TOKEN })
  await page.reload()
  await waitMatchesReady()
  await page.waitFor(`document.querySelectorAll('.item').length === 2`, { label: '删除后列表仍 2 条', timeout: 15000 })
  const afterDeleteMeta = await page.textOf('.item__meta')
  check('⑦ 删除简历后列表 resumeName 仍正常显示',
    afterDeleteMeta.includes(`使用「${RESUME_NAME}」`), afterDeleteMeta.replace(/\s+/g, ' ').slice(0, 80))

  await page.goto(`${BASE}/matches/${matchId}`)
  await waitReportReady()
  await page.waitFor(`!!document.querySelector('.score-ring__num')`, { label: '报告仍可打开', timeout: 20000 })
  const sourceText = await page.textOf('.layout__side')
  check('   删除简历后报告仍可打开，且关联资源标注「已删除」',
    sourceText.includes('已删除') && (await page.textOf('.page-head__desc')).includes(RESUME_NAME),
    sourceText.replace(/\s+/g, ' ').slice(0, 80))
  await shot('07-report-source-deleted')

  console.log('\n（提示）测试数据可手工清理：DELETE FROM sys_user WHERE username LIKE \'e2e_match_%\';')
}
finally {
  const ok = summary()
  await closeBrowser(PORT, browser)
  process.exit(ok ? 0 : 1)
}
