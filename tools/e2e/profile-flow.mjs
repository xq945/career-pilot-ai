/**
 * 个人中心端到端验证（真实浏览器）。
 *
 * 覆盖《前端原型设计》§5.13（V1.4 定死头像规格）与《API接口设计》§3.4/3.6/3.7
 * 对应的前端行为：路由与导航、昵称修改的即时同步、头像上传/替换/移除的完整交互、
 * 客户端与服务端双侧校验、页内退出登录。
 *
 * 前置条件：后端（8080，local 存储模式）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/profile-flow.mjs
 *   node tools/e2e/profile-flow.mjs --shots ./shots      # 同时输出各步骤截图
 *
 * 说明：测试头像是在浏览器内用 canvas 生成的真实 PNG（避免硬编码字节），
 * 由「移除头像」接口在用例内清理；测试账号以 e2e_ 前缀命名，脚本结束时打印清理 SQL。
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
const USER = `e2e_profile_${STAMP}`
const PASS = 'Test1234'
const NEW_NICKNAME = '求职者小张'

const { check, summary } = createChecker()

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

/**
 * 在页面内生成一张真实 PNG，并以字节形式注入 el-upload 的隐藏 file input。
 * 用 canvas 生成可保证内容真实有效（魔数、CRC 正确，<img> 能显示）。
 */
async function injectPng(fileName) {
  const b64 = await page.evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png').split(',')[1]
  })()`)
  await page.evaluate(`(() => {
    const input = document.querySelector('.el-upload input[type=file]')
    if (!input) throw new Error('file input 不存在')
    const bytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], '${fileName}', { type: 'image/png' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

/** 注入指定内容/类型/大小的 File（用于非法内容与超限用例） */
async function injectRawFile({ name, type, content, size }) {
  const payload = content !== undefined
    ? `[${JSON.stringify(content)}]`
    : `[new Uint8Array(${size})]`
  await page.evaluate(`(() => {
    const input = document.querySelector('.el-upload input[type=file]')
    if (!input) throw new Error('file input 不存在')
    const dt = new DataTransfer()
    dt.items.add(new File(${payload}, '${name}', { type: '${type}' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

const lastMessage = () => page.evaluate(
  `document.querySelector('.el-message__content')?.textContent ?? ''`)

const avatarState = () => page.evaluate(`JSON.stringify({
  pageImg: !!document.querySelector('.avatar--img'),
  pageLoaded: (() => { const i = document.querySelector('.avatar--img'); return !!i && i.naturalWidth > 0 })(),
  topbarImg: !!document.querySelector('.topbar__avatar--img'),
  stored: JSON.parse(localStorage.getItem('user') || 'null')?.avatar ?? null,
})`).then(JSON.parse)

try {
  // ------------------------------------------------------------ ① 路由守卫

  await page.goto(`${BASE}/login`)
  await page.evaluate('localStorage.clear()')

  await page.goto(`${BASE}/profile`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向' })
  let path = await page.currentPath()
  check('① 未登录直访 /profile 被重定向到登录页',
    path.startsWith('/login') && decodeURIComponent(path).includes('redirect=/profile'),
    decodeURIComponent(path))

  // ------------------------------------------------------------ ② 页面结构

  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/profile'`, { label: '登录后回跳个人中心' })

  const text = await page.evaluate('document.body.innerText')
  check('② 三张卡片渲染（基本资料 / 数据与隐私 / 登录状态）',
    text.includes('基本资料') && text.includes('数据与隐私') && text.includes('登录状态'))
  check('   数据与隐私四条说明与原型文案一致',
    text.includes('不会回传到浏览器') && text.includes('保留')
      && text.includes('仅本人可见') && text.includes('退出登录即清除'))
  check('   页面不出现「修改密码」「注销账号」入口',
    !text.includes('修改密码') && !text.includes('注销账号'))

  const disabledCount = await page.evaluate(
    `document.querySelectorAll('.el-input.is-disabled').length`)
  check('   用户名 / 邮箱 / 用户 ID 为只读禁用态', disabledCount === 3, `${disabledCount} 个禁用输入框`)

  const navActive = await page.evaluate(
    `[...document.querySelectorAll('.el-menu-item')]
       .filter((el) => el.textContent.includes('个人中心'))
       .map((el) => !el.classList.contains('is-disabled'))[0]`)
  check('   侧边栏「个人中心」入口已点亮', navActive === true)
  check('   面包屑显示「账号 / 个人中心」',
    (await page.textOf('.el-breadcrumb')).replace(/\s+/g, '').includes('账号/个人中心'))
  await shot('01-profile')

  // ------------------------------------------------------------ ③ 昵称修改与即时同步

  await page.fill(0, NEW_NICKNAME)
  await page.click('.card__foot .el-button--primary')
  await page.waitFor(
    `document.querySelector('.topbar__user-name')?.textContent === '${NEW_NICKNAME}'`,
    { label: '顶栏昵称更新' })

  check('③ 保存后顶栏即时更新为新昵称',
    (await page.textOf('.topbar__user-name')) === NEW_NICKNAME)
  const storedName = await page.evaluate(
    `JSON.parse(localStorage.getItem('user') || 'null')?.nickname`)
  check('   localStorage 同步新昵称', storedName === NEW_NICKNAME, String(storedName))

  await page.reload()
  await page.waitFor(`location.pathname === '/profile'`, { label: '刷新' })
  check('   刷新后仍为新昵称（登录态恢复链路）',
    (await page.textOf('.topbar__user-name')) === NEW_NICKNAME)
  await shot('03-nickname-saved')

  // ------------------------------------------------------------ ④ 昵称校验（前端 + 服务端）

  await page.fill(0, 'a'.repeat(51))
  // 走真实用户路径：点「保存修改」触发全量校验 → 校验失败则不发请求
  await page.click('.card__foot .el-button--primary')
  await sleep(500)
  const filledLength = await page.evaluate(
    `document.querySelectorAll('.el-input__inner')[0].value.length`)
  const clientError = await page.evaluate(
    `document.querySelector('.el-form-item__error')?.textContent ?? ''`)

  check('④ 超长昵称在保存时被前端校验拦截',
    clientError.includes('50'),
    `输入=${filledLength} 字符，组件错误=${clientError || '无'}`)

  // 绕过前端直发（带有效 Token）→ 服务端同样拒绝
  const bypass = await page.evaluate(`(async () => {
    const res = await fetch('${API}/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + localStorage.getItem('token'),
      },
      body: JSON.stringify({ nickname: 'a'.repeat(51) }),
    })
    return (await res.json()).code
  })()`)
  check('   绕过前端直发同样被服务端拒绝（40001）', bypass === 40001, `code=${bypass}`)
  await shot('04-nickname-invalid')

  // ------------------------------------------------------------ ⑤ 取消还原

  await page.fill(0, '临时输入内容')
  await page.click('.card__foot .el-button:not(.el-button--primary)')
  const cancelValue = await page.evaluate(
    `document.querySelectorAll('.el-input__inner')[0].value`)
  check('⑤ 取消后输入框还原为已保存的昵称', cancelValue === NEW_NICKNAME, cancelValue)

  // ------------------------------------------------------------ ⑥ 上传头像

  await injectPng('e2e-avatar.png')
  await page.waitFor(
    `(() => { const i = document.querySelector('.avatar--img'); return !!i && i.naturalWidth > 0 })()`,
    { label: '头像图片加载', timeout: 15000 })
  await sleep(500)

  let state = await avatarState()
  check('⑥ 上传后页面头像显示为真实图片（naturalWidth > 0）', state.pageImg && state.pageLoaded)
  check('   顶栏头像同步为图片', state.topbarImg)
  check('   localStorage 中的 avatar 为 /uploads/ 地址',
    typeof state.stored === 'string' && state.stored.startsWith('/uploads/'), String(state.stored))
  const firstUrl = state.stored
  await shot('06-avatar-uploaded')

  await page.reload()
  await page.waitFor(
    `(() => { const i = document.querySelector('.avatar--img'); return !!i && i.naturalWidth > 0 })()`,
    { label: '刷新后头像仍显示', timeout: 15000 })
  check('   刷新后头像仍然显示', (await avatarState()).pageLoaded)

  // ------------------------------------------------------------ ⑦ 替换头像

  await injectPng('e2e-avatar-2.png')
  await page.waitFor(
    `JSON.parse(localStorage.getItem('user') || 'null')?.avatar !== '${firstUrl}'`,
    { label: '头像替换', timeout: 15000 })
  await sleep(300)

  state = await avatarState()
  check('⑦ 替换后 avatar 地址变化', state.stored !== firstUrl, String(state.stored))
  check('   替换后页面头像仍正常显示', state.pageLoaded)

  const oldUrlStatus = await page.evaluate(`fetch('${firstUrl}').then((r) => r.status)`)
  check('   旧头像文件已被服务端删除（旧地址 404）', oldUrlStatus === 404, `HTTP ${oldUrlStatus}`)
  await shot('07-avatar-replaced')

  // ------------------------------------------------------------ ⑧ 伪造图片（服务端魔数校验）

  const urlBeforeFake = (await avatarState()).stored
  await injectRawFile({ name: 'fake.png', type: 'image/png', content: 'not an image at all' })
  await page.waitFor(
    `document.querySelector('.el-message__content')?.textContent?.includes('JPG') ?? false`,
    { label: '415 提示', timeout: 15000 })
  check('⑧ 伪造图片（文本改名 .png）被服务端拒绝并提示',
    (await lastMessage()).includes('JPG'), await lastMessage())
  check('   头像未被替换', (await avatarState()).stored === urlBeforeFake)
  await shot('08-fake-image')

  // ------------------------------------------------------------ ⑨ 超限文件（客户端拦截）

  await sleep(3000) // 等上一条 message 消失，避免断言串扰
  await injectRawFile({ name: 'big.png', type: 'image/png', size: 3 * 1024 * 1024 })
  await page.waitFor(
    `document.querySelector('.el-message__content')?.textContent?.includes('2 MB') ?? false`,
    { label: '大小提示', timeout: 10000 })
  check('⑨ 3MB 文件被客户端拦截并提示',
    (await lastMessage()).includes('2 MB'), await lastMessage())
  check('   头像未变化', (await avatarState()).stored === urlBeforeFake)
  await shot('09-oversize')

  // ------------------------------------------------------------ ⑩ 移除头像

  await sleep(3000)
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.avatar-row__actions .el-button')]
      .find((el) => el.textContent.trim() === '移除')
    if (!btn) throw new Error('未找到移除按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(
    `!document.querySelector('.avatar--img') && !!document.querySelector('.avatar')`,
    { label: '头像移除', timeout: 15000 })

  state = await avatarState()
  check('⑩ 移除后回退为首字符占位（页面与顶栏）',
    !state.pageImg && !state.topbarImg && state.stored === null, JSON.stringify(state))

  await page.reload()
  await page.waitFor(`location.pathname === '/profile'`, { label: '刷新' })
  check('   刷新后无头像状态保持', (await avatarState()).stored === null)
  await shot('10-avatar-removed')

  // ------------------------------------------------------------ ⑪ 页内退出登录

  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-button')]
      .find((el) => el.textContent.trim() === '退出登录')
    if (!btn) throw new Error('未找到退出登录按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(`location.pathname === '/login'`, { label: '退出后跳转登录页' })
  check('⑪ 页内退出登录：清除凭据并跳转 /login',
    await page.evaluate(`localStorage.getItem('token') === null && localStorage.getItem('user') === null`))
  await shot('11-logged-out')

  // ------------------------------------------------------------ ⑫ 顶栏菜单入口

  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/dashboard'`, { label: '重新登录' })

  await page.click('.topbar__user')
  await page.waitFor('!!document.querySelector(".el-dropdown-menu")', { label: '用户菜单' })
  await sleep(300)
  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('.el-dropdown-menu__item')]
      .find((el) => el.textContent.includes('个人中心'))
    if (!item) throw new Error('菜单中没有个人中心')
    item.click()
    return true
  })()`)
  await page.waitFor(`location.pathname === '/profile'`, { label: '菜单跳转' })
  check('⑫ 顶栏用户菜单「个人中心」入口可用', (await page.currentPath()) === '/profile')
  await shot('12-menu-entry')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM sys_user WHERE username LIKE 'e2e\\_%';`)
console.log(`  头像文件位于存储根目录的 {{该用户id}}/ 子目录，已由「移除头像」接口清理`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
