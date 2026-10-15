/**
 * M19 岗位投递入口接口层验收（《开发顺序》M19 的「接口层验收」环节）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M19 的新实例**）、MySQL 可用
 *      （job 表已按 V1.12 增量加好 apply_url 列：tmp/m19-v112-migration.sql）。
 * 成本：**1 次真实模型调用**（验收标准 4「改投递链接不使分析过期」需要一条真实分析记录；
 *      其余用例 0 次调用）。
 *
 * 覆盖验收标准（《开发顺序》M19、《API接口设计》§5.1/§5.4、《数据库设计》5.17）：
 * - 创建：带合法链接回读一致（含 trim）；省略/空串/空白 → null；
 * - 校验：非 http/https 协议 → 40000 且**不落库**；超 500 字符 → 40001（Bean Validation）；
 * - 更新：全量更新语义（省略/空串 → 清空）；非法协议 → 40000 且**原值不变**；
 * - 列表：applyUrl 随列表返回（前端「投递」按钮的渲染依据）；
 * - 过期无关：修改投递链接后 analyzed 仍为 true、stale 仍为 false（描述未变）；
 * - 越权：他人岗位详情 → 404。
 *
 * 运行：node tools/verify/m19-apply-url-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

const PASSWORD = 'verify1234'

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
  const res = await fetch(BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(150000) })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

const SUFFIX = Date.now().toString(36)

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

const DESC = '岗位职责：\n1. 参与核心业务系统的后端开发。\n\n任职要求：\n1. 熟悉 Java 与 Spring Boot。'

function jobBody(overrides = {}) {
  return { companyName: '示例科技', jobName: 'Java 后端开发实习生', description: DESC, ...overrides }
}

const URL_A = 'https://www.example.com/job/1'

console.log(`M19 岗位投递入口接口层验收：${BASE}\n`)

const { username, token } = await registerAndLogin('verify_m19')
check('前置：测试账号注册并登录成功', !!token, `username=${username}`)

// ---------------------------------------------------------------- ① 创建：归一与回读

const createOk = await api('POST', '/jobs', { token, body: jobBody({ applyUrl: '  https://www.example.com/job/1  ' }) })
check('① 创建带链接：HTTP 200 且返回 trim 后的 applyUrl',
  createOk.status === 200 && createOk.body?.data?.applyUrl === URL_A,
  `status=${createOk.status} applyUrl=${JSON.stringify(createOk.body?.data?.applyUrl)}`)

const jobId = createOk.body?.data?.id
const detailOk = await api('GET', `/jobs/${jobId}`, { token })
check('   详情回读 applyUrl 一致', detailOk.body?.data?.applyUrl === URL_A,
  `applyUrl=${JSON.stringify(detailOk.body?.data?.applyUrl)}`)

const listOk = await api('GET', '/jobs?page=1&size=10', { token })
const listRow = listOk.body?.data?.records?.find((r) => r.id === jobId)
check('   列表回读 applyUrl 一致（「投递」按钮的渲染依据）', listRow?.applyUrl === URL_A,
  `applyUrl=${JSON.stringify(listRow?.applyUrl)}`)

const createNone = await api('POST', '/jobs', { token, body: jobBody() })
check('② 创建省略 applyUrl → null', createNone.body?.data?.applyUrl === null,
  `applyUrl=${JSON.stringify(createNone.body?.data?.applyUrl)}`)

const createBlank = await api('POST', '/jobs', { token, body: jobBody({ applyUrl: '   ' }) })
check('   创建空白 applyUrl → null（清空语义）', createBlank.body?.data?.applyUrl === null,
  `applyUrl=${JSON.stringify(createBlank.body?.data?.applyUrl)}`)

const countBefore = (await api('GET', '/jobs?page=1&size=10', { token })).body?.data?.total

// ---------------------------------------------------------------- ② 校验：非法协议与超长

const jsUrl = await api('POST', '/jobs', { token, body: jobBody({ applyUrl: 'javascript:alert(1)' }) })
check('③ javascript: 伪协议被拒（40000）',
  jsUrl.status === 400 && jsUrl.body?.code === 40000,
  `status=${jsUrl.status} code=${jsUrl.body?.code} message=${jsUrl.body?.message}`)

const ftpUrl = await api('POST', '/jobs', { token, body: jobBody({ applyUrl: 'ftp://a.com/x' }) })
check('   ftp:// 被拒（40000）', ftpUrl.status === 400 && ftpUrl.body?.code === 40000,
  `status=${ftpUrl.status} code=${ftpUrl.body?.code}`)

const countAfter = (await api('GET', '/jobs?page=1&size=10', { token })).body?.data?.total
check('   两次非法创建均未落库（total 不变）', countBefore !== undefined && countAfter === countBefore,
  `before=${countBefore} after=${countAfter}`)

const tooLong = `https://a.com/${'a'.repeat(493)}` // 8 + 493 = 501 字符
const longRes = await api('POST', '/jobs', { token, body: jobBody({ applyUrl: tooLong }) })
check('④ 501 字符链接被拒（40001，Bean Validation）',
  longRes.status === 400 && longRes.body?.code === 40001,
  `len=${tooLong.length} status=${longRes.status} code=${longRes.body?.code}`)

// ---------------------------------------------------------------- ③ 过期无关：改链接不动 stale

console.log('   发起真实分析（1 次模型调用，最长 120 秒）…')
const analyzed = await api('POST', `/jobs/${jobId}/analyze`, { token })
check('⑤ 发起真实分析成功（为验证「改链接不使分析过期」准备）',
  analyzed.status === 200 && analyzed.body?.data?.status === 'SUCCESS',
  `status=${analyzed.status} analysis=${analyzed.body?.data?.status}`)

const updated = await api('PUT', `/jobs/${jobId}`, { token, body: jobBody({ applyUrl: 'https://b.com/y' }) })
check('⑥ 更新链接（描述未变）：响应 analyzed=true 且 stale=false',
  updated.body?.data?.analyzed === true && updated.body?.data?.stale === false,
  `analyzed=${updated.body?.data?.analyzed} stale=${updated.body?.data?.stale}`)
check('   applyUrl 已更新', updated.body?.data?.applyUrl === 'https://b.com/y',
  `applyUrl=${JSON.stringify(updated.body?.data?.applyUrl)}`)

const detailAfterUpdate = await api('GET', `/jobs/${jobId}`, { token })
check('   再次回读仍 analyzed=true / stale=false（投递链接与分析过期判定无关）',
  detailAfterUpdate.body?.data?.analyzed === true && detailAfterUpdate.body?.data?.stale === false,
  `analyzed=${detailAfterUpdate.body?.data?.analyzed} stale=${detailAfterUpdate.body?.data?.stale}`)

// ---------------------------------------------------------------- ④ 更新：非法拒绝且原值不变 + 清空

const badUpdate = await api('PUT', `/jobs/${jobId}`, { token, body: jobBody({ applyUrl: 'javascript:alert(2)' }) })
check('⑦ 更新为非法协议被拒（40000）', badUpdate.status === 400 && badUpdate.body?.code === 40000,
  `status=${badUpdate.status} code=${badUpdate.body?.code}`)

const detailAfterBad = await api('GET', `/jobs/${jobId}`, { token })
check('   拒绝后原值不变（未被清空或篡改）', detailAfterBad.body?.data?.applyUrl === 'https://b.com/y',
  `applyUrl=${JSON.stringify(detailAfterBad.body?.data?.applyUrl)}`)

const cleared = await api('PUT', `/jobs/${jobId}`, { token, body: jobBody({ applyUrl: '' }) })
check('⑧ 更新传空串 → 清空为 null', cleared.body?.data?.applyUrl === null,
  `applyUrl=${JSON.stringify(cleared.body?.data?.applyUrl)}`)

const omitted = await api('PUT', `/jobs/${jobId}`, { token, body: jobBody({ applyUrl: 'https://c.com/z' }) })
const omitted2 = await api('PUT', `/jobs/${jobId}`, { token, body: jobBody() })
check('   全量更新：省略 applyUrl 同样清空',
  omitted.body?.data?.applyUrl === 'https://c.com/z' && omitted2.body?.data?.applyUrl === null,
  `set=${JSON.stringify(omitted.body?.data?.applyUrl)} then=${JSON.stringify(omitted2.body?.data?.applyUrl)}`)

// ---------------------------------------------------------------- ⑤ 越权

const other = await registerAndLogin('verify_m19b')
const foreign = await api('GET', `/jobs/${jobId}`, { token: other.token })
check('⑨ 他人岗位详情 → 404（不区分"不存在"与"他人"）',
  foreign.status === 404 && foreign.body?.code === 40400,
  `status=${foreign.status} code=${foreign.body?.code}`)

// ---------------------------------------------------------------- 汇总

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`)
if (failures.length > 0) {
  console.log('失败清单：')
  for (const f of failures) {
    console.log(`  - ${f}`)
  }
}

console.log(`\n测试数据清理（后端无删除用户接口，需手工执行）：`)
console.log(`  DELETE FROM job_analysis WHERE job_id IN (SELECT id FROM job WHERE user_id IN (SELECT id FROM sys_user WHERE username LIKE 'verify_m19%'));`)
console.log(`  DELETE FROM job WHERE user_id IN (SELECT id FROM sys_user WHERE username LIKE 'verify_m19%');`)
console.log(`  DELETE FROM sys_user WHERE username LIKE 'verify_m19%';`)

process.exit(failures.length === 0 ? 0 : 1)
