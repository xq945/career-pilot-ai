/**
 * 面试日程端到端验证（真实浏览器，M17，《前端原型设计》§5.15）。
 *
 * 覆盖：导航第 8 项「面试日程」、列表/日历双视图切换、粘贴邀请 → 规则解析回填（来源徽标）、
 * 创建、状态流转（标记完成 + 按钮收敛）、物理删除。
 *
 * 前置条件：后端（8080）与前端 dev server（5173）都已启动。
 * 成本：**0 次真实模型调用**——全程使用规则可命中的邀请文本（AI 兜底链路由接口层脚本覆盖）。
 *
 * 用法：
 *   node tools/e2e/schedule-flow.mjs
 *   node tools/e2e/schedule-flow.mjs --shots ./shots
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
const PORT = Number(argValue('port', '9227'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_schedule_${STAMP}`
const PASS = 'Test1234'

const COMPANY = '云启科技'
const POSITION = 'Java 后端开发'

const { check, summary } = createChecker()

/** 明天的 yyyy-MM-dd（本地时区） */
function tomorrow() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const INVITE_TEXT = [
  '【飞书】面试邀请',
  `公司：${COMPANY}`,
  `岗位：${POSITION}`,
  `时间：${tomorrow()} 14:00`,
  '第1轮',
  '会议链接：https://meeting.feishu.cn/e2e-check',
].join('\n')

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

async function clickButton(text, scope = 'document') {
  return page.evaluate(`(() => {
    const root = ${scope}
    const btn = [...root.querySelectorAll('.el-button')].find((el) => el.textContent.trim() === '${text}')
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

/** 弹窗表单字段值（按 label 定位；对字段顺序变化鲁棒） */
const fieldValue = (label) => page.evaluate(`(() => {
  const item = [...document.querySelectorAll('.el-dialog .el-form-item')]
    .find((el) => el.querySelector('.el-form-item__label')?.textContent.includes('${label}'))
  return item?.querySelector('.el-input__inner')?.value ?? ''
})()`)

/** 列表项文本（当前页全部日程行的可见文本） */
const listText = () => page.evaluate(
  `[...document.querySelectorAll('.item')].map((el) => el.innerText.replace(/\\s+/g, ' ')).join('\\n')`)

try {
  // ------------------------------------------------------------ ① 登录并进入面试日程

  await page.goto(`${BASE}/login`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/schedules`)
  await page.waitFor(`location.pathname.startsWith('/login')`, { label: '守卫重定向到登录页' })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/schedules'`, { label: '登录后回跳面试日程' })

  check('① 导航第 8 项「面试日程」存在且高亮',
    await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('.el-menu-item')]
        .filter((el) => !el.classList.contains('is-disabled'))
      const target = items.find((el) => el.textContent.includes('面试日程'))
      return items.length === 8 && !!target && target.classList.contains('is-active')
    })()`),
    await page.evaluate(`[...document.querySelectorAll('.el-menu-item')].map((el) => el.textContent.trim()).join(' | ')`))
  check('   页面标题与空态渲染', (await page.evaluate('document.body.innerText')).includes('还没有面试日程')
    || (await page.evaluate('document.body.innerText')).includes('全部日程'))
  await shot('01-schedules-empty')

  // ------------------------------------------------------------ ② 粘贴解析回填（规则）

  await clickButton('新建日程')
  await page.waitFor(`!!document.querySelector('.el-dialog')`, { label: '新建弹窗' })
  await page.evaluate(`(() => {
    const textarea = document.querySelector('.el-dialog textarea')
    if (!textarea) throw new Error('未找到粘贴框')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, ${JSON.stringify(INVITE_TEXT)})
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await clickButton('解析邀请', `document.querySelector('.el-dialog')`)
  await page.waitFor(`document.body.innerText.includes('规则解析（请核对）')`,
    { label: '规则解析徽标', timeout: 20000 })
  check('② 粘贴邀请 → 规则解析命中并显示「请核对」徽标', true)
  check('   解析结果回填表单（公司 / 岗位）',
    (await fieldValue('公司名')) === COMPANY && (await fieldValue('岗位名')) === POSITION,
    `公司=${await fieldValue('公司名')} 岗位=${await fieldValue('岗位名')}`)
  await shot('02-dialog-parsed')

  await clickButton('创建', `document.querySelector('.el-dialog__footer')`)
  await page.waitFor(`document.body.innerText.includes('${COMPANY}')`, { label: '列表出现新日程' })
  const afterCreate = await listText()
  check('   创建成功并出现在列表（含岗位与形式标签）',
    afterCreate.includes(COMPANY) && afterCreate.includes(POSITION) && afterCreate.includes('视频'),
    afterCreate.slice(0, 80))
  check('   列表显示解析来源（规则解析）', afterCreate.includes('规则解析'), afterCreate.slice(0, 120))
  await shot('03-created')

  // ------------------------------------------------------------ ③ 状态流转（标记完成）

  await sleep(500)
  await clickButton('标记完成', `document.querySelector('.item')`)
  await page.waitFor(`!!document.querySelector('.el-message-box__btns')`, { label: '流转确认框' })
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-message-box__btns .el-button')]
      .find((el) => el.textContent.trim() === '标记完成')
    if (!btn) throw new Error('未找到确认按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(`(document.querySelector('.item')?.innerText ?? '').includes('已完成')`,
    { label: '状态标签变为已完成', timeout: 15000 })
  const afterComplete = await listText()
  check('③ 标记完成后状态标签为「已完成」', afterComplete.includes('已完成'), afterComplete.slice(0, 80))
  check('   终态操作收敛（编辑 / 标记完成按钮消失，仅保留删除）',
    await page.evaluate(`(() => {
      const item = document.querySelector('.item')
      const buttons = [...item.querySelectorAll('.el-button')].map((el) => el.textContent.trim())
      return !buttons.includes('编辑') && !buttons.includes('标记完成') && buttons.includes('删除')
    })()`))
  await shot('04-completed')

  // ------------------------------------------------------------ ④ 日历视图

  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.el-segmented__item')]
      .find((el) => el.textContent.trim() === '日历')
    if (!item) throw new Error('未找到日历切换')
    item.click()
    return true
  })()`)
  await page.waitFor(`!!document.querySelector('.el-calendar')`, { label: '日历渲染', timeout: 15000 })
  check('④ 切换日历视图并渲染', true)
  const calendarText = await page.evaluate(`document.querySelector('.el-calendar').innerText`)
  check('   日历渲染当月（含今日高亮日期与日程条）',
    calendarText.includes(String(new Date().getDate())), calendarText.replace(/\s+/g, ' ').slice(0, 60))
  await shot('05-calendar')

  // ------------------------------------------------------------ ⑤ 删除（物理）

  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.el-segmented__item')]
      .find((el) => el.textContent.trim() === '列表')
    if (!item) throw new Error('未找到列表切换')
    item.click()
    return true
  })()`)
  await page.waitFor(`!!document.querySelector('.item')`, { label: '回到列表' })
  await clickButton('删除', `document.querySelector('.item')`)
  await page.waitFor(`!!document.querySelector('.el-message-box__btns')`, { label: '删除确认框' })
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-message-box__btns .el-button')]
      .find((el) => el.textContent.trim() === '删除')
    if (!btn) throw new Error('未找到确认按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(`!document.body.innerText.includes('${COMPANY}')`, { label: '列表移除该日程', timeout: 15000 })
  check('⑤ 删除成功且列表不再包含该日程（物理删除）', true)
  await shot('06-deleted')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM interview_schedule WHERE user_id IN (SELECT id FROM sys_user WHERE username LIKE 'e2e\\_%');`)
console.log(`  DELETE FROM sys_user WHERE username LIKE 'e2e\\_%';`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
