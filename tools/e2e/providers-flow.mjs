/**
 * 模型服务页端到端验证（真实浏览器，《前端原型设计》§5.14，《API接口设计》§3A）。
 *
 * 覆盖：个人中心入口 → 列表 → 新增（校验 + 掩码）→ 编辑（留空不改 Key）→
 * 连通性测试（失败就地展示）→ 设为默认（标签切换）→ 删除规则（内置无按钮、默认禁用、
 * 自定义可删）→ 返回个人中心。
 *
 * 前置条件：后端（8080）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/providers-flow.mjs
 *   node tools/e2e/providers-flow.mjs --shots ./shots
 *
 * 说明：全部接口用**假 Key**（sk-fake-…），指向 example.com 的连通性测试预期失败
 * （验证「失败返回 ok:false 就地展示」而非 502）。测试账号以 e2e_ 前缀命名。
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
const PORT = Number(argValue('port', '9226'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_providers_${STAMP}`
const PASS = 'Test1234'
const FAKE_KEY = 'sk-fake-1234567890abcdef'

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

/** 点击页面内文本匹配的按钮（返回是否点到） */
async function clickButton(text, scope = 'document') {
  return page.evaluate(`(() => {
    const root = ${scope}
    const btn = [...root.querySelectorAll('.el-button')].find((el) => el.textContent.trim() === '${text}')
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

/** 行按钮（第 index 行、指定文本） */
async function clickRowButton(index, text) {
  return page.evaluate(`(() => {
    const row = document.querySelectorAll('.provider-row')[${index}]
    if (!row) return false
    const btn = [...row.querySelectorAll('.el-button')].find((el) => el.textContent.trim() === '${text}')
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

/** 弹窗是否可见（el-dialog 由 v-show 控制，须看 overlay 的计算样式——tools/e2e/README 坑清单） */
const dialogVisible = () => page.evaluate(`(() => {
  const d = document.querySelector('.el-dialog')
  if (!d) return false
  const overlay = d.closest('.el-overlay')
  return !!overlay && getComputedStyle(overlay).display !== 'none'
})()`)

/** 按序填充弹窗里的输入框：服务名称 / 接口地址 / 模型名 / API Key */
async function fillDialog(name, baseUrl, model, apiKey) {
  await page.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.el-dialog .el-input__inner')]
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const set = (el, value) => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(inputs[0], ${JSON.stringify(name)})
    set(inputs[1], ${JSON.stringify(baseUrl)})
    set(inputs[2], ${JSON.stringify(model)})
    set(inputs[3], ${JSON.stringify(apiKey)})
    return inputs.length
  })()`)
}

const lastMessage = () => page.evaluate(
  `document.querySelector('.el-message__content')?.textContent ?? ''`)

/** 读取列表摘要（每行：名称/标签/掩码/测试结果/按钮禁用态） */
const listState = () => page.evaluate(`JSON.stringify(
  [...document.querySelectorAll('.provider-row')].map((row) => ({
    title: row.querySelector('.provider-row__title')?.textContent.replace(/\\s+/g, ' ').trim(),
    meta: [...row.querySelectorAll('.provider-row__meta')].map((m) => m.textContent.trim()),
    test: row.querySelector('.provider-row__test')?.textContent.trim() ?? null,
    testFailed: row.querySelector('.provider-row__test')?.classList.contains('is-fail') ?? false,
    buttons: [...row.querySelectorAll('.provider-row__actions .el-button')].map((b) => ({
      text: b.textContent.trim(),
      disabled: b.classList.contains('is-disabled'),
    })),
  })),
)`).then(JSON.parse)

try {
  // ------------------------------------------------------------ ① 登录 → 个人中心入口

  // 先访问受保护路由触发守卫重定向（带 redirect 参数），登录后才会回跳个人中心
  await page.goto(`${BASE}/login`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/profile`)
  await page.waitFor(`location.pathname.startsWith('/login')`, { label: '守卫重定向到登录页' })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/profile'`, { label: '登录后回跳个人中心' })

  const profileText = await page.evaluate('document.body.innerText')
  check('① 个人中心出现「模型服务」卡片与当前默认摘要',
    profileText.includes('模型服务') && profileText.includes('平台默认'), '')
  const entered = await clickButton('管理')
  check('   点「管理」进入模型服务页', entered)
  await page.waitFor(`location.pathname === '/profile/providers'`, { label: '跳转模型服务页' })
  await page.waitFor(`document.querySelectorAll('.provider-row').length >= 3`, { label: '列表加载' })
  check('   路由为 /profile/providers 且面包屑为「账号 / 模型服务」',
    (await page.currentPath()) === '/profile/providers'
      && (await page.textOf('.el-breadcrumb')).replace(/\s+/g, '').includes('账号/模型服务'))
  await shot('01-providers-list')

  // ------------------------------------------------------------ ② 内置三家与默认标记

  let rows = await listState()
  check('② 懒初始化内置三家：deepseek（默认）/ kimi / glm',
    rows.length === 3
      && rows[0].title.includes('DeepSeek') && rows[0].title.includes('默认')
      && rows[1].title.includes('Kimi') && rows[2].title.includes('智谱'),
    JSON.stringify(rows.map((r) => r.title)))
  check('   内置服务均标「内置」且未配置 Key 显示「未配置 API Key」',
    rows.every((r) => r.title.includes('内置'))
      && rows.every((r) => r.meta.join(' ').includes('未配置 API Key')))
  check('   内置服务不显示「删除」按钮、未配置 Key 的「设为默认」禁用',
    rows.every((r) => !r.buttons.some((b) => b.text === '删除'))
      && rows.every((r) => r.buttons.find((b) => b.text === '设为默认')?.disabled === true))

  // ------------------------------------------------------------ ③ 新增（校验 + 掩码）

  await clickButton('新增服务')
  await page.waitFor(`(() => { const d = document.querySelector('.el-dialog'); return !!d && getComputedStyle(d.closest('.el-overlay')).display !== 'none' })()`,
    { label: '新增弹窗可见' })
  // 空提交 → 必填校验拦截
  await clickButton('保存', `document.querySelector('.el-dialog__footer')`)
  await sleep(400)
  const requiredErrors = await page.evaluate(
    `[...document.querySelectorAll('.el-dialog .el-form-item__error')].map((e) => e.textContent).join(' | ')`)
  check('③ 空表单提交被必填校验拦截',
    requiredErrors.includes('服务名称') && requiredErrors.includes('接口地址')
      && requiredErrors.includes('模型名') && requiredErrors.includes('API Key'),
    requiredErrors)

  // 非法 baseUrl → 格式校验
  await fillDialog('验收服务', 'ftp://wrong.example.com', 'demo-model', FAKE_KEY)
  await clickButton('保存', `document.querySelector('.el-dialog__footer')`)
  await sleep(400)
  const urlError = await page.evaluate(
    `[...document.querySelectorAll('.el-dialog .el-form-item__error')].map((e) => e.textContent).join(' | ')`)
  check('   非法接口地址（ftp://）被格式校验拦截', urlError.includes('http'), urlError)

  // 合法提交
  await fillDialog('验收服务', 'https://api.example.com/v1', 'demo-model', FAKE_KEY)
  await clickButton('保存', `document.querySelector('.el-dialog__footer')`)
  await page.waitFor(`document.querySelectorAll('.provider-row').length === 4`, { label: '列表出现新服务' })
  await sleep(600)
  rows = await listState()
  const custom = rows.find((r) => r.title.includes('验收服务'))
  check('   新增成功：列表出现自定义服务并显示掩码（前 3 后 3）',
    Boolean(custom) && custom.meta.join(' ').includes('sk-***def'), JSON.stringify(custom))
  check('   自定义服务带删除按钮且「设为默认」可用（已配置 Key）',
    custom.buttons.some((b) => b.text === '删除')
      && custom.buttons.find((b) => b.text === '设为默认')?.disabled === false)
  await shot('02-created')

  // ------------------------------------------------------------ ④ 连通性测试（失败就地展示）

  await sleep(2500) // 等上一条成功 message 消失
  const customIndex = rows.findIndex((r) => r.title.includes('验收服务'))
  await clickRowButton(customIndex, '测试')
  await page.waitFor(
    `document.querySelectorAll('.provider-row')[${customIndex}]?.querySelector('.provider-row__test') !== null`,
    { label: '测试结果出现', timeout: 30000 })
  rows = await listState()
  check('④ 指向不可达域名的测试：红字就地展示失败原因（不弹全局错误、不抛 502）',
    rows[customIndex].testFailed && (rows[customIndex].test ?? '').length > 0,
    JSON.stringify(rows[customIndex].test))
  await shot('03-test-failed')

  // ------------------------------------------------------------ ⑤ 设为默认（标签切换）

  await clickRowButton(customIndex, '设为默认')
  await page.waitFor(
    `document.querySelectorAll('.provider-row')[0].querySelector('.provider-row__title')?.textContent.includes('默认') === false`,
    { label: '默认标签切换', timeout: 15000 })
  await sleep(500)
  rows = await listState()
  check('⑤ 「设为默认」成功：默认标签从 deepseek 移到自定义服务',
    !rows[0].title.includes('默认') && rows[customIndex].title.includes('默认'),
    JSON.stringify(rows.map((r) => r.title)))
  check('   自定义服务成为默认后「设为默认」禁用（deepseek 未配置 Key 仍保持禁用）',
    rows[customIndex].buttons.find((b) => b.text === '设为默认')?.disabled === true
      && rows[0].buttons.find((b) => b.text === '设为默认')?.disabled === true)
  check('   默认服务的「删除」按钮禁用（不可删）',
    rows[customIndex].buttons.find((b) => b.text === '删除')?.disabled === true)
  await shot('04-set-default')

  // ------------------------------------------------------------ ⑥ 编辑（留空不改 Key）

  await clickRowButton(customIndex, '编辑')
  await page.waitFor(`(() => { const d = document.querySelector('.el-dialog'); return !!d && getComputedStyle(d.closest('.el-overlay')).display !== 'none' })()`,
    { label: '编辑弹窗可见' })
  const apiKeyPlaceholder = await page.evaluate(
    `document.querySelectorAll('.el-dialog .el-input__inner')[3]?.placeholder ?? ''`)
  check('⑥ 编辑弹窗：API Key 占位提示「已配置，留空则不修改」',
    apiKeyPlaceholder.includes('留空'), apiKeyPlaceholder)

  await page.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.el-dialog .el-input__inner')]
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inputs[2], 'demo-model-v2')
    inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await clickButton('保存', `document.querySelector('.el-dialog__footer')`)
  await page.waitFor(`document.body.innerText.includes('demo-model-v2')`, { label: '模型名更新' })
  await sleep(600)
  rows = await listState()
  check('   编辑生效且掩码不变（apiKey 留空未修改）',
    rows[customIndex].meta.join(' ').includes('demo-model-v2')
      && rows[customIndex].meta.join(' ').includes('sk-***def'),
    JSON.stringify(rows[customIndex].meta))
  await shot('05-edited')

  // ------------------------------------------------------------ ⑦ 切换默认与删除

  // 给 deepseek 配置（假）Key —— 否则无法把默认切回去
  const deepseekIndex = rows.findIndex((r) => r.title.includes('DeepSeek'))
  await clickRowButton(deepseekIndex, '编辑')
  await page.waitFor(`(() => { const d = document.querySelector('.el-dialog'); return !!d && getComputedStyle(d.closest('.el-overlay')).display !== 'none' })()`,
    { label: '编辑弹窗可见' })
  await page.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.el-dialog .el-input__inner')]
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inputs[3], '${FAKE_KEY}')
    inputs[3].dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await clickButton('保存', `document.querySelector('.el-dialog__footer')`)
  await page.waitFor(
    `[...document.querySelectorAll('.provider-row')[${deepseekIndex}].querySelectorAll('.provider-row__meta')].some((m) => m.textContent.includes('sk-***def'))`,
    { label: 'deepseek 掩码更新' })

  await clickRowButton(deepseekIndex, '设为默认')
  await page.waitFor(`document.querySelectorAll('.provider-row')[${deepseekIndex}].querySelector('.provider-row__title')?.textContent.includes('默认')`,
    { label: '默认切回 deepseek', timeout: 15000 })
  check('⑦ 为 deepseek 配置 Key 后可切回默认（默认必须可用的规则闭环）', true)
  await shot('06-switched-back')

  // 删除自定义服务（此时非默认、非内置 → 允许）
  await sleep(600)
  await clickRowButton(customIndex, '删除')
  await page.waitFor(`!!document.querySelector('.el-message-box__btns')`, { label: '删除确认框' })
  await clickButton('删除', `document.querySelector('.el-message-box__btns')`)
  await page.waitFor(`document.querySelectorAll('.provider-row').length === 3`, { label: '列表回到三项', timeout: 15000 })
  check('   删除自定义服务成功（列表回到内置三项）', (await listState()).length === 3)
  await shot('07-deleted')

  // ------------------------------------------------------------ ⑧ 返回个人中心

  await clickButton('← 返回个人中心')
  await page.waitFor(`location.pathname === '/profile'`, { label: '返回个人中心' })
  const summaryText = await page.evaluate('document.body.innerText')
  check('⑧ 返回个人中心：摘要显示当前默认（DeepSeek）',
    summaryText.includes('模型服务') && summaryText.includes('DeepSeek'), '')
  await shot('08-back-to-profile')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM llm_provider WHERE user_id IN (SELECT id FROM sys_user WHERE username LIKE 'e2e\\_%');`)
console.log(`  DELETE FROM sys_user WHERE username LIKE 'e2e\\_%';`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
