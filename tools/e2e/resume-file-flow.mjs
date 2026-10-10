/**
 * 简历原文件查看与下载的端到端验证（真实浏览器）。
 *
 * 覆盖《API接口设计》§4.7 / 《前端原型设计》§5.3 对应的前端行为：
 * 列表项名称可点击（预览入口）、下载图标（下载入口）、取回的内容与上传一致、
 * 下载文件名取原始文件名。
 *
 * 验证方式说明：脚本在页面内 hook `window.open` 与 `HTMLAnchorElement.prototype.click`，
 * **捕获而不真的打开新标签/触发下载**，再通过 `fetch(blob:)` 取回内容做比对——
 * 这样既能验证 blof URL 确实指向文件内容，又不会在无头环境留下新标签页或下载文件。
 * 响应头层面的行为（Content-Type / Content-Disposition、HTML 按 text/plain、越权 404）
 * 由 curl 验证，见《验证记录》。
 *
 * 前置条件：后端（8080）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/resume-file-flow.mjs
 *   node tools/e2e/resume-file-flow.mjs --shots ./shots
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
const PORT = Number(argValue('port', '9222'))
const SHOTS = argValue('shots', '')

const STAMP = Date.now()
const USER = `e2e_file_${STAMP}`
const PASS = 'Test1234'

const { check, summary } = createChecker()

const SAMPLE = '张三，计算机科学与技术专业本科应届生，熟悉 Java、Spring Boot、MySQL，'
  + '参与过校园二手交易平台的后端开发，负责用户模块与订单模块的接口设计与实现。'
const FILE_NAME = 'my-resume-file.txt'
const TXT_FILE = { name: FILE_NAME, type: 'text/plain', data: buildTxt(SAMPLE) }

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

const waitResumesReady = () => page.waitFor(
  `document.querySelector('.page-head h1')?.textContent?.trim() === '简历管理'`,
  { label: '简历页渲染完成', timeout: 20000 })

/**
 * 在页面内安装 hook：捕获 window.open 与下载链接的点击参数，**拦截这两个真实行为**
 * （无头环境下真的 open/下载会留下新标签页与无谓的下载文件）。
 *
 * 注意 `HTMLAnchorElement.prototype.click` 只拦截**带 download 属性**的链接（我们的下载动作）：
 * 「简历名称」本身也是 `<a>`，若一并覆盖，点击名称就会止步于 hook、不再派发事件，
 * Vue 的 @click 不会触发——预览路径将永远测不到。
 */
const installHooks = () => page.evaluate(`(() => {
  window.__openedUrls = []
  window.__downloads = []
  window.open = (url) => { window.__openedUrls.push(String(url)); return null }
  const originalClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (!this.hasAttribute('download')) {
      return originalClick.call(this)
    }
    window.__downloads.push({ href: String(this.href), download: String(this.download) })
  }
  return true
})()`)

/** 取回某个 blob URL 的文本内容（页面内 fetch，同源可用） */
const textOfBlob = (url) => page.evaluate(
  `(async () => (await (await fetch('${url}')).text()))()`)

try {
  // ------------------------------------------------------------ ① 登录并上传一份简历

  await page.goto(`${BASE}/resumes`)
  await page.evaluate('localStorage.clear()')
  await page.goto(`${BASE}/resumes`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向', timeout: 20000 })
  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/resumes'`, { label: '登录回跳', timeout: 20000 })
  await waitResumesReady()

  await page.evaluate(`(() => {
    ;[...document.querySelectorAll('.page-head .el-button')]
      .find((el) => el.textContent.includes('上传简历')).click()
    return true
  })()`)
  await page.waitFor(
    `(() => { const el = document.querySelector('.el-dialog .el-upload-dragger'); return !!el && el.offsetParent !== null })()`,
    { label: '上传弹窗打开' })
  await injectFile(TXT_FILE)
  await page.evaluate(`(() => {
    ;[...document.querySelectorAll('.el-dialog__footer .el-button')]
      .find((el) => el.textContent.trim() === '开始上传').click()
    return true
  })()`)
  await page.waitFor(`document.querySelectorAll('.item').length === 1`,
    { label: '列表出现 1 项', timeout: 30000 })
  check('① 上传简历后列表出现 1 项',
    (await page.evaluate(`document.querySelectorAll('.item').length`)) === 1)
  await shot('01-list')

  // ------------------------------------------------------------ ② 名称可点击（预览入口）

  check('   列表项名称为可点击链接（预览入口）',
    await page.evaluate(`!!document.querySelector('.item .item__name--link')`))
  check('   名称右侧有下载按钮',
    await page.evaluate(`!!document.querySelector('.item [title="下载原文件"]')`))

  await installHooks()
  await page.evaluate(`document.querySelector('.item .item__name--link').click()`)
  await sleep(1500)
  const openedUrl = await page.evaluate('window.__openedUrls[0]')
  const failHint = await page.evaluate(
    `[...document.querySelectorAll('.el-message')].map((e) => e.textContent.trim()).join(' | ')`)
  check('② 点击名称触发新标签预览（blob 地址）',
    String(openedUrl).startsWith('blob:'), `${String(openedUrl).slice(0, 24)}${failHint ? '；提示：' + failHint : ''}`)

  const previewText = await textOfBlob(openedUrl)
  check('   预览取回的内容与上传的原文一致',
    previewText.trim() === SAMPLE.trim(),
    `${previewText.length} 字符 vs ${SAMPLE.length}`)
  await shot('02-preview')

  // ------------------------------------------------------------ ③ 下载入口

  await installHooks()
  await page.evaluate(`document.querySelector('.item [title="下载原文件"]').click()`)
  await sleep(1500)
  const download = await page.evaluate('window.__downloads[0] || {}')
  check('③ 点击下载图标触发下载',
    String(download.href || '').startsWith('blob:'), String(download.href || '(未触发)').slice(0, 24))
  check('   下载文件名取原始文件名（含扩展名）',
    download.download === FILE_NAME, String(download.download || '(空)'))

  const downloadText = await textOfBlob(download.href)
  check('   下载取回的内容与上传的原文一致',
    downloadText.trim() === SAMPLE.trim(), `${downloadText.length} 字符`)

  // ------------------------------------------------------------ ④ 已删除简历的提示

  // 删除后该简历从列表消失，直接以旧 id 请求文件接口应得 404（前端提示来自统一错误处理）
  const resumeId = await page.evaluate(`(async () => {
    const res = await fetch('${API}/resumes?page=1&size=10', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
    })
    const body = await res.json()
    return body.data.records[0].id
  })()`)
  await page.evaluate(`(() => {
    ;[...document.querySelectorAll('.item .el-button')]
      .find((el) => el.textContent.trim() === '删除').click()
    return true
  })()`)
  await page.waitFor(`!!document.querySelector('.el-message-box')`, { label: '删除确认框', timeout: 10000 })
  await page.evaluate(`document.querySelector('.el-message-box__btns .el-button--primary').click()`)
  await page.waitFor(`document.querySelectorAll('.item').length === 0`, { label: '列表清空', timeout: 15000 })

  const goneStatus = await page.evaluate(`(async () => {
    const res = await fetch('${API}/resumes/${resumeId}/file', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
    })
    return res.status
  })()`)
  check('④ 已删除简历的文件接口返回 404', goneStatus === 404, `HTTP ${goneStatus}`)
  await shot('03-deleted')
}
finally {
  page.close()
  await closeBrowser(PORT, browser)
}

// ---------------------------------------------------------------- 汇总

const passed = summary()

const userId = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: USER, password: PASS }),
}).then((r) => r.json()).then((b) => b.data?.user?.id).catch(() => null)

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id = ${userId ?? '<uid>'});`)
console.log(`  DELETE FROM resume WHERE user_id = ${userId ?? '<uid>'};`)
console.log(`  DELETE FROM sys_user WHERE id = ${userId ?? '<uid>'};`)
console.log(`  ~/career-pilot-uploads/${userId ?? '<uid>'}/`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
