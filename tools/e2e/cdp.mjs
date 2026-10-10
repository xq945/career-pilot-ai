/**
 * 极简 CDP 客户端 —— 零依赖驱动无头 Chrome/Edge。
 *
 * 为什么不用 Playwright / Puppeteer：本机两者都没装，而 Node 22+ **内置了全局
 * `WebSocket`**，直接讲 Chrome DevTools Protocol 就够用了。Chrome 本身已是本项目
 * 渲染 SVG 的既有依赖（见 tools/brand/render.js），不引入新的运行时。
 *
 * 用途：需要"真实浏览器里点一遍"才能验证的行为 —— 路由跳转、刷新后状态恢复、
 * localStorage 读写、组件实际渲染结果。纯接口行为用 curl 更快，不必上这里。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 与 tools/brand/render.js 保持一致：可用 CHROME_PATH 覆盖，否则按序探测
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

export function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error('未找到 Chrome 或 Edge，可用环境变量 CHROME_PATH 指定路径')
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 启动一个独立的无头浏览器实例。
 *
 * `user-data-dir` 必须独立：若复用用户正在使用的默认 profile，Chrome 会拒绝启动
 * 或把调试端口让给已有实例。
 */
export async function launchBrowser({ port = 9222, windowSize = '1440,900' } = {}) {
  const executable = findBrowser()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-profile-'))

  const proc = spawn(executable, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--window-size=${windowSize}`,
    'about:blank',
  ], { stdio: 'ignore' })

  const deadline = Date.now() + 20000
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) {
        return { proc, port, profileDir, version: await res.json() }
      }
    }
    catch (error) {
      lastError = error
    }
    await sleep(200)
  }
  proc.kill()
  throw new Error(`浏览器调试端口 ${port} 未就绪：${lastError?.message || '超时'}`)
}

/** 连接到一个浏览器实例并返回操作句柄 */
export async function connect({ port = 9222 } = {}) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    throw new Error('没有可用的 page target')
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
  })

  let messageId = 0
  const pending = new Map()

  // 必须先挂监听再发指令，否则会漏掉响应
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)))
      }
      else {
        resolve(message.result)
      }
    }
  })

  function send(method, params = {}) {
    const id = ++messageId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 在页面里执行 JS。异常会抛到 Node 侧，不会静默变成 undefined */
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || '页面内 JS 异常')
    }
    return result.result.value
  }

  /** 轮询直到表达式为真；超时抛错（而不是继续跑出难懂的后续失败） */
  async function waitFor(expression, { timeout = 10000, interval = 120, label } = {}) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression).catch(() => false)) {
        return true
      }
      await sleep(interval)
    }
    throw new Error(`等待超时：${label || expression}`)
  }

  const url = (pathname) => `http://127.0.0.1:${port}` + pathname

  async function waitForMount() {
    await waitFor('document.readyState === "complete"', { label: '文档加载完成' })
  }

  /** 导航到某个页面，并等待 Vue 挂载完成（#app 有子节点） */
  async function goto(target) {
    await send('Page.navigate', { url: target })
    await waitForMount()
    await waitFor('document.querySelector("#app")?.children.length > 0', { label: `Vue 挂载 ${target}` })
  }

  async function reload() {
    await send('Page.reload')
    await waitForMount()
    await waitFor('document.querySelector("#app")?.children.length > 0', { label: 'Vue 重新挂载' })
  }

  /** 元素文本 */
  const textOf = (selector) =>
    evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent || '').trim()`)

  const exists = (selector) =>
    evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)

  const click = (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) throw new Error('找不到可点击元素: ' + ${JSON.stringify(selector)})
      el.click()
      return true
    })()`)

  /**
   * 填写输入框。
   *
   * 直接赋 `el.value` 对 Vue 的 v-model **无效** —— Vue 监听的是 input 事件，
   * 且它记录着自己的旧值。必须走原生 setter 再派发事件。
   *
   * 输入框与多行文本框的 value setter 在各自的 prototype 上（HTMLInputElement /
   * HTMLTextAreaElement），用错原型会抛 "Illegal invocation"——故按元素类型取原型。
   */
  async function fill(index, value, selector = '.el-input__inner') {
    await evaluate(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
      if (!el) throw new Error('找不到第 ${index} 个输入框')
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
  }

  /** 当前路径（含 query） */
  const currentPath = () => evaluate('location.pathname + location.search')

  async function screenshot(filePath, clip) {
    const params = { format: 'png' }
    if (clip) {
      params.clip = { ...clip, scale: clip.scale ?? 1 }
    }
    const { data } = await send('Page.captureScreenshot', params)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
    return filePath
  }

  return {
    send, evaluate, waitFor, goto, reload, screenshot,
    textOf, exists, click, fill, currentPath,
    /** 关闭连接（浏览器仍存活，由调用方决定是否 Browser.close） */
    close: () => ws.close(),
  }
}

/**
 * 优雅关闭浏览器：走 CDP 的 Browser.close，比 kill 进程干净
 * （进程是 Chrome 自己拉起的，直接 kill 主进程可能留下子进程）
 */
export async function closeBrowser(port, { proc, profileDir } = {}) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    const ws = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await sleep(500)
  }
  catch {
    proc?.kill()
  }
  if (profileDir) {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 })
  }
}

/**
 * 极简断言器：收集结果、区分通过/失败，最后统一汇总。
 * 失败**不中断**后续用例 —— 一次跑完拿到全部问题，比逐个修更快。
 */
export function createChecker() {
  const results = []

  function check(name, ok, detail = '') {
    results.push({ name, ok: !!ok, detail })
    console.log(`${ok ? '✅ 通过' : '❌ 失败'}  ${name}${detail ? `  —— ${detail}` : ''}`)
    return ok
  }

  function summary() {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${'='.repeat(64)}`)
    console.log(`共 ${results.length} 项断言，通过 ${results.length - failed.length}，失败 ${failed.length}`)
    for (const f of failed) {
      console.log(`  ❌ ${f.name}  ${f.detail}`)
    }
    return failed.length === 0
  }

  return { check, summary, results }
}
