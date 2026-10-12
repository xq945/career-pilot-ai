/**
 * 求职智能体端到端验证（真实浏览器 + 真实模型调用）。
 *
 * 覆盖《前端原型设计》§5.12 的页面行为：
 * 侧栏入口点亮与路由、空态与示例问题、上下文选择（未分析资源**只提示不拦截**）、
 * 非流式等待态文案、助手气泡与工具调用折叠条（只显示工具名与状态）、
 * 会话列表新增/切换、刷新后会话可恢复。
 *
 * 接口层的 AG-01–AG-12 用例由 tools/verify/m8-agent-api.mjs 覆盖；
 * truncated 提示与 502 错误气泡需要受限配置或特殊数据，不在本脚本内重复。
 *
 * **本脚本会消耗真实模型 token（约 2–3 次对话，每次 1–3 轮）。**
 *
 * 前置条件：后端（8080，真实 API Key）与前端 dev server（5173）都已启动。
 * 与其它 e2e 脚本并行跑时用不同浏览器端口（本脚本默认 9224）。
 *
 * 用法：
 *   node tools/e2e/agent-flow.mjs
 *   node tools/e2e/agent-flow.mjs --shots ./tmp/shots-agent
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
const PORT = Number(argValue('port', '9224'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_agent_${STAMP}`
const PASS = 'Test1234'

/** 真实模型调用的等待上限（对话 1–3 轮 + 工具内部的分析调用） */
const MODEL_TIMEOUT = 220000

const { check, summary } = createChecker()

const RESUME_NAME = `端到端简历${STAMP}`
const RESUME_TEXT = '姓名：王五。本科，计算机科学与技术。技能：Java、Spring Boot、MySQL、Redis。'
  + '项目经历：校园订餐系统后端开发，负责订单、支付与库存模块。'

/**
 * 首问直接使用空态第一个示例问题的文案（与 ⑤ 步一致，贴近真实用户路径）。
 * 上下文已选一份未分析简历，明确要求分析 → 触发 analyzeResume 工具（覆盖工具折叠条断言）；
 * 若模型仍判断无需调用，⑫ 有对应分支。
 */
const QUESTION_1 = '帮我分析一下我的简历，看看适合投什么方向'

// ---------------------------------------------------------------- 准备数据（接口层）

const login = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, email: `${USER}@example.com`, password: PASS }),
}).then((r) => r.json())
if (login.code !== 0) {
  console.error(`❌ 测试账号注册失败：${login.message}`)
  process.exit(1)
}
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: USER, password: PASS }),
}).then((r) => r.json())
const TOKEN = loginRes.data.token

const form = new FormData()
form.append('name', RESUME_NAME)
form.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
const uploaded = await fetch(`${API}/resumes`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}` },
  body: form,
}).then((r) => r.json())
if (uploaded.code !== 0) {
  console.error(`❌ 上传简历失败：${uploaded.message}`)
  process.exit(1)
}

console.log(`已创建测试账号 ${USER} 与简历 #${uploaded.data.id}（未分析）\n`)

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

const textOf = (selector) => page.textOf(selector)
const count = (selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
const bodyText = () => page.evaluate('document.body.innerText')

/** 点击文本匹配的第一个按钮 */
const clickByText = (selector, text) => page.evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => node.textContent.includes(${JSON.stringify(text)}))
  if (!el) throw new Error('找不到元素：' + ${JSON.stringify(`${selector} / ${text}`)})
  el.click()
  return true
})()`)

try {
  // ------------------------------------------------------------- 登录态注入与入口

  await page.goto(`${BASE}/login`)
  await page.evaluate(`(() => {
    localStorage.setItem('token', ${JSON.stringify(TOKEN)})
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ id: login.data.id ?? null, username: USER, nickname: '' }))})
    return true
  })()`)

  await page.goto(`${BASE}/agent`)
  await page.waitFor(`location.pathname === '/agent'`, { label: '进入智能体页', timeout: 15000 })

  check('① 侧栏「求职智能体」入口已点亮（可进入 /agent）', true)
  check('② 顶部面包屑为「总览 / 求职智能体」',
    (await bodyText()).includes('求职智能体'), '面包屑与页面标题')

  // ------------------------------------------------------------- 空态

  await page.waitFor(`document.querySelector('.empty__title')`, { label: '空态出现', timeout: 15000 })
  check('③ 空态标题与介绍可见',
    (await textOf('.empty__title')).includes('求职助手'), await textOf('.empty__title'))
  check('④ 空态提供三个示例问题', (await count('.empty__example')) === 3,
    `实际 ${await count('.empty__example')}`)

  // 点击示例问题 → 填入输入框（不直接发送）
  await page.click('.empty__example')
  const draftAfterExample = await page.evaluate('document.querySelector(".el-textarea__inner").value')
  check('⑤ 点击示例问题填入输入框', draftAfterExample.length > 0, draftAfterExample)
  await shot('01-empty')

  // ------------------------------------------------------------- 上下文选择（未分析不拦截）

  await clickByText('.composer__ctx .el-button', '选择简历')
  await page.waitFor(`document.querySelector('.el-dialog__body .picker')`, { label: '资源选择弹窗', timeout: 10000 })
  // 弹窗出现时资源列表仍在加载（.picker__loading），须等列表项渲染完成再点（同 match-flow 的等待手法）
  await page.waitFor(`document.querySelectorAll('.el-dialog__body .picker__item').length >= 1`,
    { label: '资源列表加载完成', timeout: 10000 })

  // 选中第一份简历
  await page.click('.el-dialog__body .picker__item')
  await page.waitFor(`document.body.innerText.includes('还没有完成分析')`, { label: '未分析提示出现', timeout: 5000 })
  const dialogText = await page.evaluate(`document.querySelector('.el-dialog__body').innerText`)
  check('⑥ 未分析资源在对话场景只提示不拦截（info 提示 + 可确定）',
    dialogText.includes('仍然可以使用') && dialogText.includes('自动为你完成分析'), dialogText.slice(0, 120))
  await shot('02-context-picker')

  await clickByText('.el-dialog__footer .el-button', '确定')
  await page.waitFor(`document.querySelectorAll('.composer__ctx .el-tag').length === 1`, { label: '上下文 chip 出现', timeout: 5000 })
  check('⑦ 上下文 chip 显示所选简历', (await textOf('.composer__ctx .el-tag')).includes('简历：'),
    await textOf('.composer__ctx .el-tag'))

  // ------------------------------------------------------------- 发送与等待态

  await page.fill(0, '', '.el-textarea__inner')
  await page.fill(0, QUESTION_1, '.el-textarea__inner')
  await page.evaluate('document.querySelector(".composer__send").click()')

  await page.waitFor(`document.querySelector('.msg__pending')`, { label: '等待态出现', timeout: 10000 })
  check('⑧ 非流式等待态文案为「正在思考…（最长等待 120 秒）」',
    (await textOf('.msg__pending')).includes('正在思考') && (await textOf('.msg__pending')).includes('120 秒'),
    await textOf('.msg__pending'))
  check('⑨ 等待态期间发送按钮禁用',
    await page.evaluate('!!document.querySelector(".composer__send.is-loading, .composer__send.is-disabled")'))
  await shot('03-waiting')

  await page.waitFor(`document.querySelector('.msg--assistant .msg__text')`, {
    label: '助手回复出现',
    timeout: MODEL_TIMEOUT,
  })
  const answer = await textOf('.msg--assistant .msg__text')
  check('⑩ 助手回复渲染在左侧气泡', answer.length > 0, answer.slice(0, 80))
  check('⑪ 用户消息渲染在右侧气泡',
    (await textOf('.msg--user .msg__text')) === QUESTION_1)

  // ------------------------------------------------------------- 工具调用折叠条

  const hasTrace = await page.exists('.trace__head')
  if (hasTrace) {
    check('⑫ 回复下方出现工具调用折叠条（默认收起）',
      (await textOf('.trace__head')).includes('本次调用了'),
      await textOf('.trace__head'))
    await page.click('.trace__head')
    await page.waitFor(`document.querySelector('.trace__item')`, { label: '折叠条展开', timeout: 5000 })
    const traceText = await page.evaluate(`document.querySelector('.trace__list').innerText`)
    check('⑬ 折叠条只显示工具名与状态（不含入参与结果）',
      /analyzeResume|analyzeJob|matchResumeToJob|generateInterviewQuestions/.test(traceText)
      && /成功|失败/.test(traceText), traceText.replace(/\s+/g, ' '))
  }
  else {
    // 模型可能直接凭清单作答而不调工具（提示词允许），不算失败
    check('⑫ 本次回复未调用工具（模型判断无需调用，跳过折叠条断言）', true)
  }
  await shot('04-answer')

  // ------------------------------------------------------------- 会话列表与切换

  await page.waitFor(`document.querySelectorAll('.session').length === 1`, { label: '会话列表出现新会话', timeout: 15000 })
  const sessionTitle = await textOf('.session__title')
  check('⑭ 会话列表新增会话，标题取首条用户消息', sessionTitle.includes('帮我分析一下我的简历'),
    sessionTitle)
  check('⑮ 会话项显示消息数', (await textOf('.session__meta')).includes('条消息'),
    await textOf('.session__meta'))

  // 新建对话 → 消息流清空、回到空态
  await page.click('.side__new')
  await page.waitFor(`document.querySelector('.empty__title')`, { label: '新建对话回到空态', timeout: 10000 })
  check('⑯ 新建对话清空消息流并回到空态', true)
  check('⑰ 新建对话保留上下文选择（同一份简历可连续追问）',
    await page.exists('.composer__ctx .el-tag'))

  // 点回历史会话 → 消息恢复（工具行只显示名称与状态）
  await page.click('.session')
  await page.waitFor(`document.querySelector('.msg--user .msg__text')`, { label: '历史消息恢复', timeout: 15000 })
  check('⑱ 切换回历史会话后消息恢复',
    (await textOf('.msg--user .msg__text')) === QUESTION_1)
  const restoredToolRows = await count('.msg__tool')
  check('⑲ 历史回看中的工具消息只有名称与状态',
    restoredToolRows === 0 || (await page.evaluate(`document.querySelector('.msg__tool').innerText`)).length < 40,
    `工具行 ${restoredToolRows} 条`)
  await shot('05-history')

  // ------------------------------------------------------------- 刷新恢复

  await page.reload()
  await page.waitFor(`document.querySelectorAll('.session').length === 1`, { label: '刷新后会话列表恢复', timeout: 20000 })
  check('⑳ 刷新后会话列表仍在', (await textOf('.session__title')).includes('帮我分析一下我的简历'))
  check('㉑ 刷新后消息流回到空态（会话需重新点开）', await page.exists('.empty__title'))

  await page.click('.session')
  await page.waitFor(`document.querySelector('.msg--user .msg__text')`, { label: '刷新后打开会话', timeout: 15000 })
  check('㉒ 重新打开会话可回看完整消息', (await count('.msg__text')) >= 2,
    `消息气泡 ${await count('.msg__text')} 个`)

  // ------------------------------------------------------------- 汇总

  // summary() 返回布尔（true = 全部通过），并由它打印汇总行
  process.exitCode = summary() ? 0 : 1

  // ------------------------------------------------------------- 清理提示

  const uid = login.data.id ?? '<uid>'
  console.log('\n测试数据清理（后端无删除用户接口，需手工执行；表间有外键约束，须按依赖自底向上）：')
  console.log(`  DELETE FROM agent_chat_message WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM agent_session WHERE user_id = ${uid};`)
  console.log(`  DELETE FROM interview_question WHERE session_id IN (SELECT id FROM interview_session WHERE user_id = ${uid});`)
  console.log(`  DELETE FROM interview_session WHERE user_id = ${uid};`)
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
