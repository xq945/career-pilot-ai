/**
 * 简历管理端到端验证（真实浏览器）。
 *
 * 覆盖《开发顺序》M3 的验收标准与《前端原型设计》§5.3 对应的前端行为：
 * 路由与导航、空态、多渠道上传（DOCX/HTML/TXT/PDF）、前端即时校验、
 * 服务端 415/400/413 三类失败（弹窗内提示且保持打开）、删除二次确认与三条后果、
 * 分页条显隐与翻页、刷新后数据保持。
 *
 * 接口层的格式校验与错误码矩阵由 curl 验证（见《验证记录》§4.1），本脚本只补
 * 浏览器独有的部分（页面交互、渲染结果、前端预检的实际拦截）。
 *
 * 前置条件：后端（8080）与前端 dev server（5173）都已启动。
 *
 * 用法：
 *   node tools/e2e/resume-flow.mjs
 *   node tools/e2e/resume-flow.mjs --shots ./shots      # 同时输出各步骤截图
 *
 * 说明：测试文件由 fixtures.mjs 在内存中动态构造（零二进制入库），经 base64
 * 注入 el-upload 的隐藏 file input；测试账号以 e2e_resume_ 前缀命名，脚本结束时
 * 打印清理 SQL（数据与物理文件目录一并清理）。
 */
import { closeBrowser, connect, createChecker, launchBrowser, sleep } from './cdp.mjs'
import { buildDocx, buildEmptyPdf, buildHtml, buildPdf, buildTxt } from './fixtures.mjs'

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
const USER = `e2e_resume_${STAMP}`
const PASS = 'Test1234'
const CUSTOM_NAME = '我的第一份简历'

const { check, summary } = createChecker()

// ---------------------------------------------------------------- 测试文件

const SAMPLE = '张三，计算机科学与技术专业本科应届生，熟悉 Java、Spring Boot、MySQL，'
  + '参与过校园二手交易平台的后端开发，负责用户模块与订单模块的接口设计与实现。'

const FILES = {
  docx: { name: 'my-resume.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: buildDocx([SAMPLE]) },
  html: { name: 'web-resume.html', type: 'text/html', data: buildHtml(SAMPLE) },
  txt: { name: 'plain-resume.txt', type: 'text/plain', data: buildTxt(SAMPLE) },
  pdf: { name: 'english-resume.pdf', type: 'application/pdf', data: buildPdf(['Zhang San - Backend Developer', 'Skills: Java, Spring Boot, MySQL.']) },
  emptyPdf: { name: 'scanned.pdf', type: 'application/pdf', data: buildEmptyPdf() },
  fakePdf: { name: 'fake.pdf', type: 'application/pdf', data: Buffer.from('plain text pretending to be a pdf, no magic header at all') },
  jpg: { name: 'photo-resume.jpg', type: 'image/jpeg', data: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]) },
}

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

/** 在浏览器内构造大文件（不上传 Node 侧的大字节，避免 base64 膨胀） */
async function injectBigFile(name, type, megabytes) {
  await page.evaluate(`(() => {
    const input = document.querySelector('.el-upload input[type=file]')
    if (!input) throw new Error('file input 不存在')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(${megabytes} * 1024 * 1024)], '${name}', { type: '${type}' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

/** 弹窗内的错误提示文案 */
const dialogError = () => page.evaluate(
  `[...document.querySelectorAll('.el-dialog .el-alert--error .el-alert__content')].map((e) => e.textContent.trim()).join(' ')`)

/** 列表项数量 */
const itemCount = () => page.evaluate(`document.querySelectorAll('.item').length`)

/**
 * 弹窗是否可见。
 *
 * el-dialog 用 v-show 控制显隐（DOM 常驻、首次打开才渲染），因此**不能用
 * querySelector 是否存在来判断**——关闭后的弹窗节点仍在 DOM 中。
 * 改用 offsetParent：display:none 的元素的 offsetParent 为 null。
 */
const DIALOG_VISIBLE = `(() => {
  const el = document.querySelector('.el-dialog .el-upload-dragger')
  return !!el && el.offsetParent !== null
})()`

/**
 * 等待简历页渲染完成。
 *
 * 路由跳转的 URL 更新与异步组件（ResumesView）的加载、渲染之间有时序差：
 * `location.pathname` 匹配后 DOM 仍是上一页，首次访问还叠加了 Vite 的按需编译。
 */
const waitResumesReady = () => page.waitFor(
  `document.querySelector('.page-head h1')?.textContent?.trim() === '简历管理'`,
  { label: '简历页渲染完成', timeout: 20000 })

/** 打开上传弹窗并等待就绪 */
async function openUploadDialog() {
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.page-head .el-button')]
      .find((el) => el.textContent.includes('上传简历'))
    if (!btn) throw new Error('找不到上传按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(DIALOG_VISIBLE, { label: '上传弹窗打开' })
}

/** 点击弹窗底部按钮（按文案） */
async function clickDialogButton(text) {
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-dialog__footer .el-button')]
      .find((el) => el.textContent.trim() === '${text}')
    if (!btn) throw new Error('找不到按钮：${text}')
    btn.click()
    return true
  })()`)
}

/** 上传成功后：等弹窗关闭 + 列表新增一项 */
async function waitUploadSuccess(expectedCount) {
  await page.waitFor(`!(${DIALOG_VISIBLE})`, { label: '弹窗关闭', timeout: 15000 })
  await page.waitFor(`document.querySelectorAll('.item').length === ${expectedCount}`,
    { label: `列表变为 ${expectedCount} 项`, timeout: 15000 })
}

try {
  // ------------------------------------------------------------ ① 守卫与导航

  await page.goto(`${BASE}/login`)
  await page.evaluate('localStorage.clear()')

  await page.goto(`${BASE}/resumes`)
  await page.waitFor(`location.pathname === '/login'`, { label: '守卫重定向' })
  check('① 未登录直访 /resumes 被重定向到登录页',
    (await page.currentPath()).includes('redirect=/resumes'), await page.currentPath())

  await page.fill(0, USER)
  await page.fill(1, PASS)
  await page.click('.auth__submit')
  await page.waitFor(`location.pathname === '/resumes'`, { label: '登录后回跳简历页', timeout: 15000 })
  await waitResumesReady()

  const navReady = await page.evaluate(
    `[...document.querySelectorAll('.el-menu-item')]
       .filter((el) => el.textContent.includes('简历管理'))
       .map((el) => !el.classList.contains('is-disabled'))[0]`)
  check('   侧边栏「简历管理」入口已点亮', navReady === true)
  check('   面包屑显示「求职材料 / 简历管理」',
    (await page.textOf('.el-breadcrumb')).replace(/\s+/g, '').includes('求职材料/简历管理'))
  check('   页面标题正确',
    (await page.evaluate('document.title')) === '简历管理 · 智能求职辅助平台')
  await shot('01-resumes-empty')

  // ------------------------------------------------------------ ② 空态

  // 列表数据是异步拉取的：页面渲染完成后才能判定空态（加载中显示的是骨架屏）
  await page.waitFor(`document.body.innerText.includes('还没有简历')`, { label: '空态渲染', timeout: 15000 })
  const emptyText = await page.evaluate('document.body.innerText')
  check('② 新账号显示空态（标题 + 说明 + 上传按钮）',
    emptyText.includes('还没有简历') && emptyText.includes('系统会自动提取文本'))
  check('   空态下不显示分页条', !(await page.exists('.pagination-bar')))

  // ------------------------------------------------------------ ③ 上传 DOCX

  await openUploadDialog()
  check('③ 点击「上传简历」打开弹窗', await page.evaluate(DIALOG_VISIBLE))
  check('   弹窗提示含支持格式与大小上限',
    (await page.textOf('.el-upload__tip')).includes('PDF、DOCX、DOC、HTML、TXT')
      && (await page.textOf('.el-upload__tip')).includes('10 MB'))

  await injectFile(FILES.docx)
  await page.waitFor(`document.body.innerText.includes('已选择')`, { label: '已选择文件', timeout: 10000 })
  check('   选中文件后显示「已选择：文件名（大小）」',
    (await page.evaluate('document.body.innerText')).includes('my-resume.docx'))

  await page.fill(0, CUSTOM_NAME, '.el-dialog .el-input__inner')
  await clickDialogButton('开始上传')
  await waitUploadSuccess(1)

  check('   上传成功后弹窗关闭、列表出现 1 项',
    (await page.textOf('.item__name')) === CUSTOM_NAME)
  check('   状态标签为「未分析」',
    (await page.textOf('.item__title .el-tag')) === '未分析')
  check('   页内成功提示出现',
    (await page.evaluate('document.body.innerText')).includes('上传成功，文本已提取'))
  await shot('02-docx-uploaded')

  // ------------------------------------------------------------ ④⑤ 上传 HTML 与 TXT

  await openUploadDialog()
  await injectFile(FILES.html)
  await clickDialogButton('开始上传')
  await waitUploadSuccess(2)
  check('④ 上传 HTML 成功（名称缺省取原文件名）',
    (await page.evaluate(`[...document.querySelectorAll('.item__name')].map((e) => e.textContent).join('|')`))
      .includes('web-resume.html'))

  await openUploadDialog()
  await injectFile(FILES.txt)
  await page.fill(0, '中文简历名称', '.el-dialog .el-input__inner')
  await clickDialogButton('开始上传')
  await waitUploadSuccess(3)
  check('⑤ 上传 TXT 成功（自定义中文名称生效）',
    (await page.evaluate(`[...document.querySelectorAll('.item__name')].map((e) => e.textContent).join('|')`))
      .includes('中文简历名称'))

  // ------------------------------------------------------------ ⑥ 刷新保持

  await page.reload()
  await page.waitFor(`document.querySelectorAll('.item').length === 3`, { label: '刷新后列表仍 3 项' })
  check('⑥ 刷新后列表数据保持（来自后端）', (await itemCount()) === 3)
  check('   分页条显示「共 3 条」且单页时隐藏页码按钮',
    (await page.textOf('.pagination-bar__info')) === '共 3 条'
      && !(await page.exists('.pagination-bar .el-pager')))

  // ------------------------------------------------------------ ⑦ 前端拦截：非法类型

  await openUploadDialog()
  await injectFile(FILES.jpg)
  await page.waitFor(`!!document.querySelector('.el-dialog .el-alert--error')`, { label: '类型提示', timeout: 10000 })
  check('⑦ JPG（本版不支持）被前端即时拦截并提示',
    (await dialogError()).includes('仅支持 PDF、DOCX、DOC、HTML、TXT'), await dialogError())
  check('   未发出请求（列表仍 3 项）', (await itemCount()) === 3)
  await shot('03-client-reject-type')
  await clickDialogButton('取消')

  // ------------------------------------------------------------ ⑧ 前端拦截：超限

  await openUploadDialog()
  await injectBigFile('huge.pdf', 'application/pdf', 11)
  await page.waitFor(`!!document.querySelector('.el-dialog .el-alert--error')`, { label: '大小提示', timeout: 15000 })
  check('⑧ 11MB 文件被前端即时拦截并提示',
    (await dialogError()).includes('不能超过 10 MB'), await dialogError())
  check('   未发出请求（列表仍 3 项）', (await itemCount()) === 3)
  await clickDialogButton('取消')

  // ------------------------------------------------------------ ⑨ 服务端 415（伪 PDF）

  await openUploadDialog()
  await injectFile(FILES.fakePdf)
  check('   伪 PDF 通过前端预检（扩展名与大小合规，内容由服务端判定）',
    (await page.evaluate('document.body.innerText')).includes('fake.pdf'))
  await clickDialogButton('开始上传')
  await page.waitFor(`!!document.querySelector('.el-dialog .el-alert--error')`, { label: '服务端 415 提示', timeout: 15000 })
  check('⑨ 服务端返回 415，弹窗内提示且弹窗保持打开',
    (await dialogError()).includes('文件类型不支持')
      && await page.evaluate(DIALOG_VISIBLE),
    await dialogError())
  check('   列表未变化（仍 3 项）', (await itemCount()) === 3)
  await shot('04-server-415')

  // ------------------------------------------------------------ ⑩ 服务端 400（无文本 PDF）

  await injectFile(FILES.emptyPdf)
  await clickDialogButton('开始上传')
  await page.waitFor(
    `[...document.querySelectorAll('.el-dialog .el-alert--error .el-alert__content')]
       .some((e) => e.textContent.includes('提取文字'))`,
    { label: '服务端 400 提示', timeout: 15000 })
  check('⑩ 无文本 PDF 返回 400，提示提取失败且弹窗保持打开',
    (await dialogError()).includes('未能从文件中提取文字')
      && await page.evaluate(DIALOG_VISIBLE))
  check('   列表未变化（仍 3 项）', (await itemCount()) === 3)
  await shot('05-server-400')
  await clickDialogButton('取消')

  // ------------------------------------------------------------ ⑪ 服务端 413（绕过前端直发）

  const bigCode = await page.evaluate(`(async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(11 * 1024 * 1024)], 'big.txt', { type: 'text/plain' }))
    const res = await fetch('${API}/resumes', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
      body: form,
    })
    return (await res.json()).code
  })()`)
  check('⑪ 绕过前端直接提交 11MB → 413/41300（不是 500）', bigCode === 41300, `code=${bigCode}`)

  // ------------------------------------------------------------ ⑫ 上传 PDF 成功

  await openUploadDialog()
  await injectFile(FILES.pdf)
  await clickDialogButton('开始上传')
  await waitUploadSuccess(4)
  check('⑫ 上传 PDF 成功', (await itemCount()) === 4)
  await shot('06-pdf-uploaded')

  // ------------------------------------------------------------ ⑬ 删除

  const deleteTarget = await page.evaluate(
    `!!document.querySelector('.item .el-button--danger')
      && [...document.querySelectorAll('.item')].some((el) => el.textContent.includes('web-resume.html'))`)
  check('   找到 HTML 简历行（含删除按钮）', deleteTarget === true)

  const deletedId = await page.evaluate(`(async () => {
    const res = await fetch('${API}/resumes?size=100', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
    })
    const body = await res.json()
    return body.data.records.find((r) => r.name === 'web-resume.html').id
  })()`)

  await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('.item')].find((el) => el.textContent.includes('web-resume.html'))
    row.querySelector('.el-button--danger').click()
    return true
  })()`)
  await page.waitFor('!!document.querySelector(".el-message-box")', { label: '删除确认弹窗' })
  const confirmText = await page.textOf('.el-message-box')
  check('⑬ 删除确认弹窗写清三条后果',
    ['同步删除', '保留', '关联简历已删除'].every((kw) => confirmText.includes(kw)),
    confirmText.replace(/\s+/g, ' ').slice(0, 120))

  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-message-box__btns .el-button')]
      .find((el) => el.textContent.includes('确认删除'))
    btn.click()
    return true
  })()`)
  await page.waitFor(`document.querySelectorAll('.item').length === 3`, { label: '列表少一项', timeout: 15000 })
  check('   确认后列表移除该项', (await itemCount()) === 3)
  await shot('07-deleted')

  const detailStatus = await page.evaluate(`fetch('${API}/resumes/${deletedId}', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
  }).then((r) => r.status)`)
  check('   已删除简历的详情返回 404（逻辑删除生效）', detailStatus === 404, `HTTP ${detailStatus}`)

  const repeatCode = await page.evaluate(`fetch('${API}/resumes/${deletedId}', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
  }).then(async (r) => (await r.json()).code)`)
  check('   重复删除幂等成功（code = 0）', repeatCode === 0, `code=${repeatCode}`)

  // ------------------------------------------------------------ ⑭ 分页

  // 批量补足到 11 条（走接口，快于 UI 操作）
  const bulk = await page.evaluate(`(async () => {
    let ok = 0
    for (let i = 0; i < 8; i++) {
      const form = new FormData()
      form.append('file', new File([new TextEncoder().encode('批量简历 ${STAMP}-' + i + '：' + '用于分页验证的文本内容。'.repeat(6))], 'bulk-' + i + '.txt', { type: 'text/plain' }))
      const res = await fetch('${API}/resumes', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
        body: form,
      })
      if ((await res.json()).code === 0) ok++
    }
    return ok
  })()`)
  check('   批量上传 8 份成功（总数 11）', bulk === 8, `成功 ${bulk} 份`)

  await page.reload()
  await page.waitFor(`document.querySelectorAll('.item').length === 10`, { label: '第一页 10 项', timeout: 15000 })
  check('⑭ 11 条数据分两页：第一页 10 项、页码按钮出现',
    (await page.textOf('.pagination-bar__info')) === '共 11 条'
      && await page.exists('.pagination-bar .el-pager'))

  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.el-pager li')].find((el) => el.textContent.trim() === '2')
    if (!btn) throw new Error('找不到第 2 页按钮')
    btn.click()
    return true
  })()`)
  await page.waitFor(`document.querySelectorAll('.item').length === 1`, { label: '第二页 1 项', timeout: 15000 })
  check('   翻到第 2 页显示剩余 1 项', (await itemCount()) === 1)
  await shot('08-pagination')
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
console.log(`  -- 数据库（先删简历再看情况删账号）：`)
console.log(`  DELETE FROM resume_analysis WHERE resume_id IN (SELECT id FROM resume WHERE user_id = ${userId ?? '<uid>'});`)
console.log(`  DELETE FROM resume WHERE user_id = ${userId ?? '<uid>'};`)
console.log(`  DELETE FROM sys_user WHERE id = ${userId ?? '<uid>'};`)
console.log(`  -- 物理文件目录（${userId ?? '<uid>'} 为该用户的子目录）：`)
console.log(`  ~/career-pilot-uploads/${userId ?? '<uid>'}/`)
if (SHOTS) {
  console.log(`截图目录：${SHOTS}`)
}

process.exit(passed ? 0 : 1)
