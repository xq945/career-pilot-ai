/**
 * 认证闭环端到端验证（真实浏览器）。
 *
 * 覆盖《API接口设计》第 3 节对应的前端行为：注册、登录、路由守卫、刷新恢复登录态、
 * 令牌失效的统一登出、退出登录、404。
 *
 * 前置条件：后端（8080）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/auth-flow.mjs
 *   node tools/e2e/auth-flow.mjs --base http://localhost:5173 --api http://localhost:8080/api
 *   node tools/e2e/auth-flow.mjs --shots ./shots      # 同时输出各步骤截图
 *
 * 说明：本脚本会在数据库里留下 2 个 `e2e_*` 测试用户（后端未提供删除用户的接口），
 * 运行结束时会打印清理用的 SQL。
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
const PORT = Number(argValue('port', '9222'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const SEED_USER = `e2e_seed_${STAMP}`
const SEED_PASS = 'Test1234'
const NEW_USER = `e2e_new_${STAMP}`
const NEW_EMAIL = `${NEW_USER}@example.com`

const { check, summary } = createChecker()

async function api(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

// ---------------------------------------------------------------- 准备测试账号

console.log(`前置检查：后端 ${API} / 前端 ${BASE}\n`)

const seed = await api('/auth/register', {
  username: SEED_USER,
  email: `${SEED_USER}@example.com`,
  password: SEED_PASS,
}).catch((error) => ({ status: 0, body: { message: error.message } }))

if (seed.status !== 200) {
  console.error(`❌ 无法创建测试账号（后端未启动？）：HTTP ${seed.status} ${seed.body.message || ''}`)
  process.exit(1)
}
console.log(`已创建测试账号 ${SEED_USER}\n`)

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
  // ------------------------------------------------------------ ① 路由守卫

  await page.goto(`${BASE}/login`)
  await page.evaluate('localStorage.clear()')

  // 根路径按《前端原型设计》§1.1 重定向到 /dashboard，未登录时再被守卫拦到登录页
  await page.goto(`${BASE}/`)
  await page.waitFor(`location.pathname === '/login'`, { label: '根路径重定向' })
  check('① 未登录访问 / 最终落到登录页',
    (await page.currentPath()).startsWith('/login'), await page.currentPath())

  // 带 query 访问，验证守卫保留的是**完整**来源路径而不只是路径部分
  await page.goto(`${BASE}/dashboard?probe=1`)
  let path = await page.currentPath()
  check('   未登录访问受保护路由被重定向到登录页', path.startsWith('/login'), path)
  // Vue Router 不编码 query 里的 `/` 与 `?`，断言前先解码
  check('   重定向保留完整来源（含 query）以便登录后回跳',
    decodeURIComponent(path).includes('redirect=/dashboard?probe=1'), decodeURIComponent(path))
  await shot('01-guard')

  // ------------------------------------------------------------ ② 登录失败

  await page.fill(0, SEED_USER)
  await page.fill(1, 'WrongPass999')
  await page.click('.auth__submit')
  await page.waitFor('!!document.querySelector(".el-alert__title")', { label: '错误提示' })

  const errText = await page.textOf('.el-alert__title')
  check('② 错误密码给出提示且不区分「未注册」与「密码错误」',
    errText === '用户名或密码错误，请重新输入', errText)
  check('   失败后停留在登录页', (await page.currentPath()).startsWith('/login'))
  await shot('02-login-failed')

  // ------------------------------------------------------------ ③ 登录成功

  await page.fill(1, SEED_PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '跳转工作台' })
  await page.waitFor('!!document.querySelector(".topbar__user-name")', { label: '顶栏渲染' })

  const stored = await page.evaluate(`JSON.stringify({
    token: !!localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
  })`)
  const { token, user } = JSON.parse(stored)

  check('③ 登录后回跳到守卫记录的来源页',
    (await page.currentPath()) === '/dashboard?probe=1', await page.currentPath())
  check('   localStorage 写入 token', token === true)
  check('   localStorage 写入 user 且不含密码字段',
    user?.username === SEED_USER && !('password' in user), JSON.stringify(user))
  check('   顶栏显示当前用户', (await page.textOf('.topbar__user-name')) === SEED_USER)
  check('   页面标题符合「页面名 · 站点名」规范',
    (await page.evaluate('document.title')) === '工作台 · 智能求职辅助平台',
    await page.evaluate('document.title'))
  check('   页面展示 /api/user/profile 的资料',
    await page.evaluate(`document.body.innerText.includes(${JSON.stringify(SEED_USER)})`))
  await shot('03-dashboard')

  // 响应式（《前端原型设计》§2.3）：≤900px 时侧边栏收起为图标条
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 800, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await sleep(400)
  const narrowSidebar = await page.evaluate(
    `Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)`)
  check('   窄屏（800px）下侧边栏收起为图标条', narrowSidebar === 64, `${narrowSidebar}px`)
  await shot('03b-narrow')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await sleep(400)

  // ------------------------------------------------------------ ④ 刷新恢复

  await page.reload()
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '刷新后仍在工作台' })
  check('④ 刷新页面后登录状态恢复',
    await page.evaluate(`!!localStorage.getItem('token') && !!document.querySelector('.topbar__user-name')`))

  // ------------------------------------------------------------ ⑤ 已登录访问公开页

  await page.goto(`${BASE}/login`)
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '/login 重定向' }).catch(() => {})
  check('⑤ 已登录访问 /login 被重定向到 /dashboard',
    (await page.currentPath()) === '/dashboard', await page.currentPath())

  // ------------------------------------------------------------ ⑥ 令牌失效

  // 用无效值模拟"令牌已失效"（真实过期的 JWT 由接口层用另签的过期 token 验证）
  await page.evaluate(`localStorage.setItem('token', 'invalid.token.value')`)
  await page.reload()
  await page.waitFor(`location.pathname === '/login'`, { label: '失效后跳转登录页' })

  check('⑥ 令牌失效后自动登出并回到登录页', (await page.currentPath()).startsWith('/login'))
  check('   失效后本地凭据被清除',
    await page.evaluate(`localStorage.getItem('token') === null && localStorage.getItem('user') === null`))

  const expireTip = await page.waitFor('!!document.querySelector(".el-message__content")', { label: '过期提示' })
    .then(() => page.textOf('.el-message__content')).catch(() => '')
  check('   给出「登录已过期」提示', expireTip.includes('登录已过期'), expireTip)
  await shot('06-token-expired')

  // ------------------------------------------------------------ ⑦ 退出登录

  await page.fill(0, SEED_USER)
  await page.fill(1, SEED_PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '重新登录' })

  await page.click('.topbar__user')
  await page.waitFor('!!document.querySelector(".el-dropdown-menu")', { label: '用户菜单' })
  await sleep(300)
  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.el-dropdown-menu__item')]
      .find((el) => el.textContent.includes('退出登录'))
    if (!item) throw new Error('菜单中没有退出登录')
    item.click()
    return true
  })()`)
  await page.waitFor(`location.pathname === '/login'`, { label: '退出后回到登录页' })

  check('⑦ 退出登录后回到登录页且凭据被清除',
    await page.evaluate(`localStorage.getItem('token') === null && localStorage.getItem('user') === null`))
  await shot('07-logged-out')

  await page.goto(`${BASE}/dashboard`)
  check('   退出后无法再访问受保护页面', (await page.currentPath()).startsWith('/login'))

  // ------------------------------------------------------------ ⑧ 注册页校验

  await page.goto(`${BASE}/register`)
  await page.fill(0, 'ab')
  await page.fill(1, 'not-an-email')
  await page.fill(2, 'abcdefgh')
  await page.fill(3, 'abcdefgh')
  await page.click('.auth__submit')
  await page.waitFor('!!document.querySelector(".el-form-item__error")', { label: '字段校验' })

  const fieldErrors = await page.evaluate(
    `[...document.querySelectorAll('.el-form-item__error')].map((e) => e.textContent.trim())`)
  check('⑧ 前端校验同时报出用户名/邮箱/密码三类错误', fieldErrors.length >= 3,
    fieldErrors.join(' | '))
  await shot('08-register-validation')

  // 服务端错误定位到字段
  await page.goto(`${BASE}/register`)
  await page.fill(0, SEED_USER)
  await page.fill(1, `${SEED_USER}@example.com`)
  await page.fill(2, SEED_PASS)
  await page.fill(3, SEED_PASS)
  await page.click('.auth__submit')
  await page.waitFor('!!document.querySelector(".el-form-item__error")', { label: '服务端字段错误' })

  const serverErrors = await page.evaluate(
    `[...document.querySelectorAll('.el-form-item__error')].map((e) => e.textContent.trim())`)
  check('   服务端「用户名已被占用」定位到用户名字段',
    serverErrors.some((t) => t.includes('用户名已被占用')), serverErrors.join(' | '))
  await shot('09-register-server-error')

  // ------------------------------------------------------------ ⑨ 注册并自动登录

  await page.goto(`${BASE}/register`)
  await page.fill(0, NEW_USER)
  await page.fill(1, NEW_EMAIL)
  await page.fill(2, SEED_PASS)
  await page.fill(3, SEED_PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '注册后自动登录' })

  const registered = await page.evaluate(`JSON.parse(localStorage.getItem('user') || 'null')?.username`)
  check('⑨ 注册成功后自动登录并跳转工作台', registered === NEW_USER, `注册用户 ${registered}`)
  await shot('10-register-success')

  // ------------------------------------------------------------ ⑩ 404

  await page.goto(`${BASE}/no-such-page`)
  await page.waitFor('!!document.querySelector(".el-result")', { label: '404 页' })
  check('⑩ 未知路径渲染 404 页', (await page.textOf('.el-result__title')).includes('404'))
  await shot('11-not-found')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM sys_user WHERE username LIKE 'e2e\\_%';`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
