/**
 * M18 图形验证码接口层验收。
 *
 * 前置：后端已在 8080 运行，且**必须以"校验开启 + 固定文本 + 短有效期"启动**：
 *   APP_CAPTCHA_FIXED_TEXT=Ab12 APP_CAPTCHA_EXPIRE_SECONDS=2 \
 *     APP_OPTIMIZATION_ASYNC_ENABLED=false mvn spring-boot:run
 *   - FIXED_TEXT 必须等于本脚本的 FIXED_CODE（脚本看不到图片内容，只能填约定的固定码）；
 *   - EXPIRE_SECONDS=2 是「过期」用例的前提（本脚本不 sleep 等待 300 秒）。
 *   不按此配置启动时，脚本会在开头明确报出配置不符，而不是给一堆难以理解的失败。
 * 成本：0 次真实模型调用。
 *
 * 覆盖验收标准（《开发顺序》M18、《API接口设计》§3.3）：
 * - 取码：白名单放行（无 Token 可访问）、响应含 captchaId/imageBase64/expiresIn/enabled、
 *   图片是带格式前缀的 data URI 且解码后为合法 PNG、每次取码 id 都不同；
 * - 登录成功：正确验证码 + 正确账号密码 → 200，且新签发的 JWT 能访问受保护接口；
 * - 拒绝场景（均须 400/40002 且**不签发 JWT**）：验证码错误、缺少 captchaId、缺少 captchaCode、
 *   两者都缺、未知 captchaId、过期；
 * - 一次性：用过的 captchaId（无论成功还是失败）立即作废，重复提交第二次必拒；
 * - 刷新：传 replace 后旧 captchaId 不可用、新 captchaId 可用；
 * - 大小写不敏感（与 Hutool RandomGenerator.verify 的比对语义一致）；
 * - 验证码先于账号密码校验：验证码正确但密码错误仍是原有的 40100（不改变既有登录语义）。
 *
 * 运行：node tools/verify/m18-captcha-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

const PASSWORD = 'verify1234'

/** 必须与后端 APP_CAPTCHA_FIXED_TEXT 一致；含大小写混排以便验证"忽略大小写" */
const FIXED_CODE = 'Ab12'

/** 需配合后端 APP_CAPTCHA_EXPIRE_SECONDS=2 */
const EXPIRY_WAIT_MS = 2500

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  [OK] ${name}`)
  } else {
    failures.push(detail ? `${name} — ${detail}` : name)
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(30000) })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

const SUFFIX = Date.now().toString(36)

/** 取码；传 replace 时后端会同时作废该 captchaId */
async function takeCaptcha(replace) {
  const query = replace ? `?replace=${encodeURIComponent(replace)}` : ''
  return (await api('GET', `/auth/captcha${query}`)).body?.data
}

function doLogin(body) {
  return api('POST', '/auth/login', { body })
}

async function main() {
  // ---------------------------------------------------------------- 组 0：前置校验

  console.log('== 组 0：运行前置 ==')
  const probe = await api('GET', '/auth/captcha')
  if (probe.status !== 200 || probe.body?.code !== 0) {
    console.error(`❌ 取码接口不可用：HTTP ${probe.status} ${probe.body?.message ?? ''}（后端未启动？）`)
    process.exit(1)
  }
  if (probe.body.data?.enabled !== true) {
    console.error('❌ 后端未开启验证码校验。请以 APP_CAPTCHA_ENABLED=true（默认即为 true）启动后重跑本脚本。')
    process.exit(1)
  }
  if (probe.body.data?.expiresIn > 5) {
    console.warn(`⚠️  当前 expiresIn=${probe.body.data.expiresIn} 秒：`
      + '「过期」用例需要后端以 APP_CAPTCHA_EXPIRE_SECONDS=2 启动。')
  }
  check('后端配置符合前置要求（校验开启）', probe.body.data?.enabled === true)

  const username = `m18_${SUFFIX}`
  const registered = await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  check('测试账号注册成功（注册接口不需要验证码）', registered.body?.code === 0, registered.body?.message)

  // ---------------------------------------------------------------- 组 1：取码接口

  console.log('\n== 组 1：取码接口 ==')
  const first = probe.body.data
  check('无 Token 可取码（白名单放行）', probe.status === 200, `HTTP ${probe.status}`)
  check('响应含 captchaId / imageBase64 / expiresIn / enabled',
    Boolean(first?.captchaId) && Boolean(first?.imageBase64) && first?.expiresIn > 0,
    JSON.stringify({ id: Boolean(first?.captchaId), img: Boolean(first?.imageBase64), exp: first?.expiresIn }))
  check('imageBase64 是带格式前缀的 data URI（前端可直接用作 img.src）',
    String(first?.imageBase64).startsWith('data:image/png;base64,'),
    String(first?.imageBase64).slice(0, 32))
  const pngBytes = Buffer.from(String(first?.imageBase64).replace(/^data:image\/png;base64,/, ''), 'base64')
  check('解码后是合法 PNG（魔数 89 50 4E 47）',
    pngBytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    [...pngBytes.subarray(0, 4)].join(' '))
  const another = await takeCaptcha()
  check('每次取码的 captchaId 都不同（不是固定值）',
    Boolean(another?.captchaId) && another.captchaId !== first?.captchaId)

  // ---------------------------------------------------------------- 组 2：登录成功

  console.log('\n== 组 2：登录成功（正确验证码 + 正确账号密码） ==')
  const okCaptcha = await takeCaptcha()
  const loginOk = await doLogin({
    account: username, password: PASSWORD,
    captchaId: okCaptcha.captchaId, captchaCode: FIXED_CODE,
  })
  check('登录成功且返回 token',
    loginOk.body?.code === 0 && Boolean(loginOk.body?.data?.token),
    `HTTP ${loginOk.status} / code ${loginOk.body?.code}`
    + `（若为 40002，多半是后端 APP_CAPTCHA_FIXED_TEXT 不等于 ${FIXED_CODE}）`)

  const token = loginOk.body?.data?.token
  const profile = await api('GET', '/user/profile', { token })
  check('新签发的 JWT 可访问受保护接口', profile.body?.code === 0, profile.body?.message)

  // ---------------------------------------------------------------- 组 3：拒绝场景

  console.log('\n== 组 3：拒绝场景（一律 400/40002，且不签发 JWT） ==')

  const wrongCaptcha = await takeCaptcha()
  const wrongCode = await doLogin({
    account: username, password: PASSWORD,
    captchaId: wrongCaptcha.captchaId, captchaCode: 'zzzz',
  })
  check('验证码错误 → 40002', wrongCode.body?.code === 40002,
    `HTTP ${wrongCode.status} / code ${wrongCode.body?.code}`)
  check('验证码错误时不签发 JWT', !wrongCode.body?.data?.token)

  const afterWrong = await doLogin({
    account: username, password: PASSWORD,
    captchaId: wrongCaptcha.captchaId, captchaCode: FIXED_CODE,
  })
  check('失败一次后该 captchaId 立即作废（换成正确码也不能再用）',
    afterWrong.body?.code === 40002, afterWrong.body?.message)

  const noId = await doLogin({ account: username, password: PASSWORD, captchaCode: FIXED_CODE })
  check('缺少 captchaId → 40002', noId.body?.code === 40002, noId.body?.message)
  check('缺少 captchaId 时不签发 JWT', !noId.body?.data?.token)

  const spareCaptcha = await takeCaptcha()
  const noCode = await doLogin({
    account: username, password: PASSWORD, captchaId: spareCaptcha.captchaId,
  })
  check('缺少 captchaCode → 40002', noCode.body?.code === 40002, noCode.body?.message)
  check('缺少 captchaCode 时不签发 JWT', !noCode.body?.data?.token)

  const noBoth = await doLogin({ account: username, password: PASSWORD })
  check('两个字段都缺 → 40002', noBoth.body?.code === 40002, noBoth.body?.message)

  const unknownId = await doLogin({
    account: username, password: PASSWORD, captchaId: 'no-such-id', captchaCode: FIXED_CODE,
  })
  check('未知 captchaId → 40002', unknownId.body?.code === 40002, unknownId.body?.message)

  // 验证码先于账号密码校验：验证码对了才轮到原有的 40100，说明既有登录语义未被改变
  const passCaptcha = await takeCaptcha()
  const badPassword = await doLogin({
    account: username, password: 'WrongPass999',
    captchaId: passCaptcha.captchaId, captchaCode: FIXED_CODE,
  })
  check('验证码正确但密码错误 → 40100（验证码先于账号密码校验）',
    badPassword.body?.code === 40100, `code ${badPassword.body?.code}`)
  check('密码错误时不签发 JWT', !badPassword.body?.data?.token)

  // ---------------------------------------------------------------- 组 4：一次性与刷新

  console.log('\n== 组 4：一次性消费与刷新 ==')

  const reuseCaptcha = await takeCaptcha()
  const reuseFirst = await doLogin({
    account: username, password: PASSWORD,
    captchaId: reuseCaptcha.captchaId, captchaCode: FIXED_CODE,
  })
  check('同一验证码首次提交成功', reuseFirst.body?.code === 0 && Boolean(reuseFirst.body?.data?.token),
    reuseFirst.body?.message)

  const reuseSecond = await doLogin({
    account: username, password: PASSWORD,
    captchaId: reuseCaptcha.captchaId, captchaCode: FIXED_CODE,
  })
  check('同一验证码重复提交 → 第二次 40002', reuseSecond.body?.code === 40002, reuseSecond.body?.message)
  check('重复提交时不签发 JWT', !reuseSecond.body?.data?.token)

  const beforeRefresh = await takeCaptcha()
  const afterRefresh = await takeCaptcha(beforeRefresh.captchaId)
  check('刷新（传 replace）返回新的 captchaId', afterRefresh?.captchaId !== beforeRefresh?.captchaId)

  const staleUse = await doLogin({
    account: username, password: PASSWORD,
    captchaId: beforeRefresh.captchaId, captchaCode: FIXED_CODE,
  })
  check('刷新后旧 captchaId → 40002（旧验证码不可继续使用）',
    staleUse.body?.code === 40002, staleUse.body?.message)

  const freshUse = await doLogin({
    account: username, password: PASSWORD,
    captchaId: afterRefresh.captchaId, captchaCode: FIXED_CODE,
  })
  check('刷新后的新 captchaId 可正常使用', freshUse.body?.code === 0, freshUse.body?.message)

  const caseCaptcha = await takeCaptcha()
  const lowerCase = await doLogin({
    account: username, password: PASSWORD,
    captchaId: caseCaptcha.captchaId, captchaCode: FIXED_CODE.toLowerCase(),
  })
  check(`验证码比对忽略大小写（以 ${FIXED_CODE.toLowerCase()} 提交 ${FIXED_CODE}）`,
    lowerCase.body?.code === 0, lowerCase.body?.message)

  const spaceCaptcha = await takeCaptcha()
  const spaced = await doLogin({
    account: username, password: PASSWORD,
    captchaId: spaceCaptcha.captchaId, captchaCode: `  ${FIXED_CODE} `,
  })
  check('验证码比对容忍首尾空白（移动端输入法常带空格）', spaced.body?.code === 0, spaced.body?.message)

  // 并发双发同一 captchaId：一次性消费是"先摘除后比对"的原子操作，必须恰好放行一个
  const raceCaptcha = await takeCaptcha()
  const [raceA, raceB] = await Promise.all([
    doLogin({ account: username, password: PASSWORD, captchaId: raceCaptcha.captchaId, captchaCode: FIXED_CODE }),
    doLogin({ account: username, password: PASSWORD, captchaId: raceCaptcha.captchaId, captchaCode: FIXED_CODE }),
  ])
  const raceCodes = [raceA.body?.code, raceB.body?.code].sort((a, b) => a - b)
  check('并发提交同一验证码：恰好一个成功、另一个 40002',
    raceCodes[0] === 0 && raceCodes[1] === 40002, raceCodes.join(' / '))

  // ---------------------------------------------------------------- 组 5：过期

  console.log(`\n== 组 5：过期（等待 ${EXPIRY_WAIT_MS} ms，需后端 APP_CAPTCHA_EXPIRE_SECONDS=2） ==`)
  const expiringCaptcha = await takeCaptcha()
  await new Promise((resolve) => setTimeout(resolve, EXPIRY_WAIT_MS))
  const expired = await doLogin({
    account: username, password: PASSWORD,
    captchaId: expiringCaptcha.captchaId, captchaCode: FIXED_CODE,
  })
  check('过期验证码 → 40002', expired.body?.code === 40002,
    `实际 code ${expired.body?.code}（若为 0，说明后端 expire-seconds 大于 2 秒）`)
  check('过期时不签发 JWT', !expired.body?.data?.token)

  console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
  console.log(`  DELETE FROM sys_user WHERE username LIKE 'm18\\_%';`)
}

main()
  .then(() => {
    console.log(`\n结果：通过 ${passed} 项，失败 ${failures.length} 项`)
    if (failures.length) {
      failures.forEach((item) => console.log(`  - ${item}`))
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('脚本异常：', error)
    process.exit(1)
  })
