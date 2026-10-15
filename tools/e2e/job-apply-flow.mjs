/**
 * M19 岗位投递入口用例（**零模型调用**，见《验证记录》§22.4）。
 *
 * 覆盖《前端原型设计》§5.5（M19）：
 * - 新建弹窗增「投递链接」字段，且**位于前两个输入框之后**（`job-flow.mjs` 按索引填表的前提不破）；
 * - 填了链接 → 列表出现「投递」按钮；点击实际调用 window.open(url, '_blank', 'noopener,noreferrer')；
 * - 编辑弹窗回填 applyUrl；清空链接 → 按钮消失（不填不渲染）；
 * - 表单校验：非 http/https 的链接被前端拦截，弹窗不关闭。
 *
 * 前置：后端 8080（**`APP_CAPTCHA_ENABLED=false`**，否则登录页多一行验证码、输入框索引错位）
 *      + 前端 dev server 5173。默认浏览器端口 9222（与 `job-flow.mjs` 相同——两者都在岗位页，不并行跑）。
 *
 * 用法：node tools/e2e/job-apply-flow.mjs
 */
import { closeBrowser, connect, createChecker, launchBrowser, sleep } from './cdp.mjs'

const BASE = 'http://localhost:5173'
const API = 'http://localhost:8080/api'
const PORT = 9222
const STAMP = Date.now()
const USER = `e2e_apply_${STAMP}`
const PASS = 'Test1234'

const COMPANY = '示例科技'
const JOB_NAME = 'Java 后端开发实习生'
const DESC = '岗位职责：\n1. 参与核心业务系统的后端开发。\n\n任职要求：\n1. 熟悉 Java 与 Spring Boot。'
const URL_A = 'https://www.example.com/job/12345'

const { check, summary } = createChecker()

const seed = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, email: `${USER}@example.com`, password: PASS }),
}).then((r) => r.json()).catch((error) => ({ message: error.message }))
if (seed.code !== 0) {
  console.error(`❌ 无法创建测试账号：${seed.message}`)
  process.exit(1)
}

const browser = await launchBrowser({ port: PORT })
const page = await connect({ port: PORT })
await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const shot = async (name) => {
  await sleep(400)
  await page.screenshot(`./tmp/shots-job-apply/${name}.png`)
}

const clickDialogButton = (text) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
    .find((el) => el.textContent.trim() === '${text}')
  if (!btn) throw new Error('找不到弹窗按钮：${text}')
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

const itemButtons = () => page.evaluate(
  `[...document.querySelectorAll('.item .el-button')].map((el) => el.textContent.trim())`)

const dialogOpen = () => page.evaluate(
  `(() => { const el = document.querySelector('.el-dialog'); return !!el && el.offsetParent !== null })()`)

try {
  // ------------------------------------------------------------ 登录进入岗位页

  await page.goto(`${BASE}/jobs`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/jobs`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/jobs'`, { label: '回跳岗位页', timeout: 20000 })
  await page.waitFor(`document.querySelector('.page-head h1')?.textContent?.trim() === '岗位管理'`,
    { label: '岗位页渲染', timeout: 20000 })

  // ------------------------------------------------------------ ① 表单字段位置与校验

  await page.evaluate(`[...document.querySelectorAll('.page-head .el-button')]
    .find((el) => el.textContent.includes('新建岗位')).click()`)
  await page.waitFor(`(() => { const el = document.querySelector('.el-dialog'); return !!el && el.offsetParent !== null })()`,
    { label: '弹窗打开' })

  const placeholders = await page.evaluate(
    `[...document.querySelectorAll('.el-dialog .el-input__inner')].map((el) => el.placeholder)`)
  check('① 弹窗前两个输入框仍是「公司名称 / 岗位名称」（投递链接排在其后）',
    placeholders.length === 3
      && placeholders[0].includes('示例科技')
      && placeholders[1].includes('Java 后端开发实习生')
      && placeholders[2].includes('投递链接') === false
      && placeholders[2].includes('https://'),
    JSON.stringify(placeholders))

  // 前端协议校验：填非法链接 → 拦截
  await page.fill(2, 'javascript:alert(1)', '.el-dialog .el-input__inner')
  await clickDialogButton('保存')
  await sleep(600)
  const errors = await page.evaluate(
    `[...document.querySelectorAll('.el-dialog .el-form-item__error')].map((e) => e.textContent.trim())`)
  check('② 非法协议被前端拦截（提示含 http）',
    errors.some((t) => t.includes('http')) && await dialogOpen(), errors.join('/'))

  // ------------------------------------------------------------ ② 填合法链接创建

  await page.fill(0, COMPANY)
  await page.fill(1, JOB_NAME)
  await page.fill(2, URL_A)
  await page.fill(0, DESC, '.el-dialog .el-textarea__inner')
  await clickDialogButton('保存')
  await page.waitFor(`document.querySelectorAll('.item').length === 1`, { label: '列表出现新岗位', timeout: 20000 })

  check('③ 填了链接：列表出现「投递」按钮', (await itemButtons()).includes('投递'),
    (await itemButtons()).join('/'))
  await shot('01-list-with-apply')

  // ------------------------------------------------------------ ③ 点击投递 → window.open 参数

  await page.evaluate(`(() => {
    window.__opened = []
    window.open = (...args) => { window.__opened.push(args); return null }
    return true
  })()`)
  await clickItemButton('投递')
  await sleep(300)
  const opened = await page.evaluate('window.__opened ?? []')
  check('④ 点击「投递」调用 window.open(链接, _blank, noopener)',
    opened.length === 1 && opened[0][0] === URL_A
      && opened[0][1] === '_blank' && String(opened[0][2]).includes('noopener'),
    JSON.stringify(opened))

  // ------------------------------------------------------------ ④ 编辑清空链接 → 按钮消失

  await clickItemButton('编辑')
  await page.waitFor(`document.querySelector('.el-dialog .el-input__inner')?.value === '${COMPANY}'`,
    { label: '详情回填', timeout: 15000 })
  const filledUrl = await page.evaluate(
    `[...document.querySelectorAll('.el-dialog .el-input__inner')][2]?.value ?? ''`)
  check('⑤ 编辑弹窗回填 applyUrl', filledUrl === URL_A, `value=${JSON.stringify(filledUrl)}`)

  await page.fill(2, '', '.el-dialog .el-input__inner')
  await clickDialogButton('保存')
  await page.waitFor(`document.querySelectorAll('.item').length === 1`, { label: '列表刷新', timeout: 20000 })
  await sleep(500)
  check('⑥ 清空链接后「投递」按钮消失（仅其余按钮保留）',
    !(await itemButtons()).includes('投递'), (await itemButtons()).join('/'))
  await shot('02-list-without-apply')

  // ------------------------------------------------------------ ⑤ 收尾：删除岗位

  await clickItemButton('删除')
  await page.waitFor(`!!document.querySelector('.el-message-box')`, { label: '删除确认框', timeout: 10000 })
  await page.evaluate(`document.querySelector('.el-message-box__btns .el-button--primary').click()`)
  await page.waitFor(`document.querySelectorAll('.item').length === 0`, { label: '列表清空', timeout: 20000 })
  check('⑦ 收尾：删除岗位成功（列表回到空态）', true)
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

const passed = summary()
console.log(`\n测试数据清理：DELETE FROM sys_user WHERE username = '${USER}';`)
process.exit(passed ? 0 : 1)
