/**
 * 登录图形验证码的浏览器端验收（M18）。
 *
 * 前置：后端（8080）与前端 dev server（5173）都已启动，且后端**必须以验证码开启 + 固定文本**运行：
 *   APP_CAPTCHA_FIXED_TEXT=Ab12 APP_OPTIMIZATION_ASYNC_ENABLED=false mvn spring-boot:run
 *   脚本看不到图片内容，只能填约定的固定码（FIXED_CODE）；不按此配置启动时，
 *   「验证码错误」与「登录成功」两步会失败 —— 那是配置不符，不是实现缺陷。
 *
 * 与 auth-flow.mjs 的分工：auth-flow 跑在 `APP_CAPTCHA_ENABLED=false` 下（验证码行不渲染，
 * 于是它对登录页的 DOM 断言与加验证码之前逐字一致）；本脚本跑在开启态，专门覆盖验证码这一行。
 *
 * 用法：
 *   node tools/e2e/captcha-flow.mjs
 *   node tools/e2e/captcha-flow.mjs --base http://localhost:5173 --api http://localhost:8080/api
 *   node tools/e2e/captcha-flow.mjs --shots ./shots
 *
 * 说明：本脚本会在数据库里留下 1 个 `e2e_captcha_*` 测试用户，结束时会打印清理用的 SQL。
 */
import { closeBrowser, connect, createChecker, launchBrowser } from './cdp.mjs'

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
const USER = `e2e_captcha_${STAMP}`
const PASS = 'Test1234'

/** 必须与后端 APP_CAPTCHA_FIXED_TEXT 一致 */
const FIXED_CODE = 'Ab12'

const { check, summary } = createChecker()

/** 登录页三个输入框（账号 / 密码 / 验证码）的取值，按 DOM 顺序 */
const INPUT_VALUES = `[...document.querySelectorAll('.el-form-item input')].map((el) => el.value)`
/**
 * 整串带括号：它要和 `!==` 拼进 waitFor 的条件表达式里。
 * 注意 `??` 与 `&&` 不允许不加括号混用（会是语法错误），故用 `||` 兜底。
 */
const CAPTCHA_SRC = `(document.querySelector('.auth__captcha-img')?.src || '')`

// ---------------------------------------------------------------- 准备测试账号

const seed = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, email: `${USER}@example.com`, password: PASS }),
}).then((res) => res.json()).catch((error) => ({ code: -1, message: error.message }))

if (seed.code !== 0) {
  console.error(`❌ 无法创建测试账号（后端未启动？）：${seed.message}`)
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

try {
  // ------------------------------------------------------------ ① 加载即自动获取

  await page.goto(`${BASE}/login`)
  await page.evaluate('localStorage.clear()')
  await page.waitFor('!!document.querySelector(".auth__captcha-img")', { label: '验证码图' })

  const firstSrc = await page.evaluate(CAPTCHA_SRC)
  check('① 进入登录页即自动获取验证码',
    firstSrc.startsWith('data:image/png;base64,'), firstSrc.slice(0, 32))

  const inputTypes = await page.evaluate(
    `[...document.querySelectorAll('.el-form-item input')].map((el) => el.type)`)
  check('   验证码输入框排在密码之后（页外脚本按索引定位输入框的前提）',
    inputTypes.length === 3 && inputTypes[1] === 'password',
    inputTypes.join(' / '))
  await shot('01-captcha-loaded')

  // ------------------------------------------------------------ ② 点击图片刷新

  await page.click('.auth__captcha-img')
  await page.waitFor(`${CAPTCHA_SRC} !== ${JSON.stringify(firstSrc)}`, { label: '验证码已刷新' })

  const secondSrc = await page.evaluate(CAPTCHA_SRC)
  check('② 点击验证码图片换了一张新图（干扰线随机，图片字节必变）',
    secondSrc !== firstSrc && secondSrc.startsWith('data:image/png;base64,'))

  // ------------------------------------------------------------ ③ 验证码错误

  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.fill(2, 'zzzz')
  await page.click('.auth__submit')
  await page.waitFor('!!document.querySelector(".el-alert__title")', { label: '错误提示' })

  const errText = await page.textOf('.el-alert__title')
  check('③ 验证码错误时给出提示且不跳转', errText.includes('验证码'), errText)
  check('   仍停留在登录页', (await page.currentPath()).startsWith('/login'))

  // 失败后应自动换图（后端已消费掉那一张）
  await page.waitFor(`${CAPTCHA_SRC} !== ${JSON.stringify(secondSrc)}`, { label: '失败后自动换图' })
  const thirdSrc = await page.evaluate(CAPTCHA_SRC)
  check('   验证码错误后自动刷新出新图', thirdSrc !== secondSrc)
  await shot('02-captcha-wrong')

  // ------------------------------------------------------------ ④ 失败后的输入保留策略

  const [accountValue, passwordValue, codeValue] = await page.evaluate(INPUT_VALUES)
  check('④ 失败后保留账号输入', accountValue === USER, accountValue)
  check('   失败后清空密码（敏感输入不回填）', passwordValue === '', passwordValue)
  check('   失败后清空验证码输入', codeValue === '', codeValue)

  // ------------------------------------------------------------ ⑤ 正确验证码登录

  // 先点一次图片换张新的：上一步那张已被服务端消费，且本环境有效期很短（APP_CAPTCHA_EXPIRE_SECONDS）
  await page.click('.auth__captcha-img')
  await page.waitFor(`${CAPTCHA_SRC} !== ${JSON.stringify(thirdSrc)}`, { label: '重新取一张验证码' })

  // 密码必须重填：上一步刚断言过它已被清空（失败即清空敏感输入），照着真实用户的操作走
  await page.fill(1, PASS)
  await page.fill(2, FIXED_CODE)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '跳转工作台' })
  await page.waitFor('!!document.querySelector(".topbar__user-name")', { label: '顶栏渲染' })

  check('⑤ 填对验证码后登录成功并跳转工作台',
    (await page.currentPath()) === '/dashboard', await page.currentPath())
  check('   顶栏显示当前用户（JWT 正常签发）',
    (await page.textOf('.topbar__user-name')) === USER)
  await shot('03-login-success')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM sys_user WHERE username LIKE 'e2e\\_captcha\\_%';`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
