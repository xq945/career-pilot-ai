/**
 * M14 模型服务接口层验收（《开发顺序》M14 的「接口层验收」环节；用 Node fetch 实现
 * 等价的用例组，可复现、可断言、可重跑）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M14 的新实例**）、MySQL 可用
 *      （llm_provider 表已按《数据库设计》V1.8 的增量注释块建好）。
 * 成本：**至多 1 次真实模型调用**（deepseek 连通性测试项；脚本自动尝试从
 *      application-local.yml 读取 DeepSeek API Key，读不到时该项标记 SKIP）。
 *      另含 1 次「预期失败」的连通性测试（指向不可达域名，验证失败返回 ok:false 而非 502）。
 *
 * 覆盖验收标准（《开发顺序》M14）：
 * - 首次访问懒初始化内置三家（deepseek 默认、均 builtin、未配置 Key）且响应只含掩码；
 * - 自定义服务：创建（providerKey 自动生成、掩码前 3 后 3）、更新（apiKey 留空不变、
 *   内置 baseUrl 被忽略）、删除；
 * - 规则：内置不可删 / 当前默认不可删 / 未配置 Key 不可设为默认（均 400 且提示可读）；
 * - 切换默认：成功、旧默认被清除、缓存失效（新调用即时生效属运行时行为，人工核验）；
 * - 连通性：成功返回 ok:true（真实调用）；失败返回 ok:false（**不是 502**）；
 * - 越权：他人服务 ID → 404（更新 / 删除 / 测试 / 设默认，不泄露存在性）。
 *
 * 运行：node tools/verify/m14-llm-provider-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
import { readFileSync } from 'node:fs'

const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

/** 验收专用密码（满足 8 位且含字母与数字的注册规则） */
const PASSWORD = 'verify1234'

let passed = 0
let skipped = 0
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

function skip(name, reason = '') {
  skipped += 1
  console.log(`  [SKIP] ${name}${reason ? ` — ${reason}` : ''}`)
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

// ---------------------------------------------------------------- 测试数据

const SUFFIX = Date.now().toString(36)

/** 假 Key（只用于加密落库与掩码断言；指向 example.com 的连通性测试预期失败） */
const FAKE_KEY = 'sk-fake-1234567890abcdef'

/**
 * 解析连通性测试用的真实 Key（用于「成功路径」项；解析不到时该项标记 SKIP）。
 *
 * 优先级：环境变量 `M14_PROVIDER_TEST_KEY` → 本机 application-local.yml 的**明文**值。
 * 注意 yml 可能写成 `${ENV_VAR}` 引用形式（脚本不做环境变量解析，读到的是字面引用文本，
 * 直接发出去会得到 401）——因此只采用 `sk-` 开头的值，其余一律视为不可用。
 * 无论哪种来源，Key 只进入请求体、不打印。
 */
function readProviderTestKey() {
  const fromEnv = process.env.M14_PROVIDER_TEST_KEY
  if (fromEnv) {
    return fromEnv
  }
  try {
    const path = new URL('../../career-pilot-server/src/main/resources/application-local.yml', import.meta.url)
    const text = readFileSync(path, 'utf8')
    const match = text.match(/^[ \t]*api-key:\s*["']?([^"'\s#]+)/m)
    const value = match ? match[1] : null
    return value && value.startsWith('sk-') ? value : null
  }
  catch {
    return null
  }
}

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('== 准备：注册两个账号 ==')
  const userA = await registerAndLogin('m14a')
  const userB = await registerAndLogin('m14b')
  check('账号注册与登录成功', Boolean(userA.token && userB.token))
  if (!userA.token || !userB.token) {
    return
  }

  // ------------------------------------------------------------ 组 1：懒初始化内置三家

  console.log('\n== 组 1：首次列表懒初始化内置三家（不产生模型调用） ==')
  const list = await api('GET', '/llm-providers', { token: userA.token })
  const providers = list.body?.data ?? []
  check('列表返回内置三家', providers.length === 3,
    JSON.stringify(providers.map((p) => p.providerKey)))
  const byKey = Object.fromEntries(providers.map((p) => [p.providerKey, p]))
  check('deepseek 为默认且是内置服务',
    byKey.deepseek?.isDefault === true && byKey.deepseek?.builtin === true)
  check('kimi / glm 均为内置且非默认',
    byKey.kimi?.builtin === true && byKey.kimi?.isDefault === false
      && byKey.glm?.builtin === true && byKey.glm?.isDefault === false)
  check('内置未配置 Key：maskedApiKey 全为 null（不含明文或密文）',
    providers.every((p) => p.maskedApiKey === null))

  // ------------------------------------------------------------ 组 2：创建自定义服务

  console.log('\n== 组 2：创建自定义服务（假 Key，加密落库、响应只含掩码） ==')
  const created = await api('POST', '/llm-providers', {
    token: userA.token,
    body: {
      displayName: '验收自定义服务',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo-model',
      apiKey: FAKE_KEY,
      temperature: 0.5,
    },
  })
  const custom = created.body?.data
  check('创建成功且 providerKey 自动生成为 custom-1',
    created.body?.code === 0 && custom?.providerKey === 'custom-1', created.body?.message)
  if (!custom?.id) {
    return
  }
  check('响应只含掩码（前 3 后 3），整段响应不含明文 Key',
    custom.maskedApiKey === 'sk-***def' && !JSON.stringify(custom).includes(FAKE_KEY),
    JSON.stringify(custom))
  check('自定义服务 kind=OPENAI、非内置、非默认、已启用',
    custom.kind === 'OPENAI' && custom.builtin === false
      && custom.isDefault === false && custom.enabled === true)

  // ------------------------------------------------------------ 组 3：更新规则

  console.log('\n== 组 3：更新（apiKey 留空 = 不修改；内置 baseUrl 被忽略） ==')
  const updated = await api('PUT', `/llm-providers/${custom.id}`, {
    token: userA.token,
    body: { displayName: '验收服务(改)', model: 'demo-model-2' },
  })
  check('更新成功：名称与模型生效、掩码不变（apiKey 未被清空或替换）',
    updated.body?.data?.displayName === '验收服务(改)'
      && updated.body?.data?.model === 'demo-model-2'
      && updated.body?.data?.maskedApiKey === 'sk-***def',
    JSON.stringify(updated.body?.data))

  const builtinUpdate = await api('PUT', `/llm-providers/${byKey.deepseek.id}`, {
    token: userA.token,
    body: { baseUrl: 'https://should-be-ignored.example.com' },
  })
  check('内置服务的 baseUrl 更新被忽略（保持内置定义）',
    builtinUpdate.body?.data?.baseUrl === 'https://api.deepseek.com',
    builtinUpdate.body?.data?.baseUrl)

  // ------------------------------------------------------------ 组 4：切换默认与删除规则

  console.log('\n== 组 4：切换默认（旧默认被清除）与删除规则 ==')
  await api('PUT', `/llm-providers/${byKey.deepseek.id}`, {
    token: userA.token,
    body: { apiKey: FAKE_KEY },
  })
  const setDefault = await api('PUT', `/llm-providers/${custom.id}/default`, { token: userA.token })
  check('切换默认成功（目标已启用且已配置 Key）',
    setDefault.body?.code === 0 && setDefault.body?.data?.isDefault === true,
    setDefault.body?.message)

  const listAfterSwitch = await api('GET', '/llm-providers', { token: userA.token })
  const afterSwitch = Object.fromEntries((listAfterSwitch.body?.data ?? []).map((p) => [p.providerKey, p]))
  check('旧默认（deepseek）被清除、新默认唯一',
    afterSwitch.deepseek?.isDefault === false && afterSwitch['custom-1']?.isDefault === true)

  const deleteDefault = await api('DELETE', `/llm-providers/${custom.id}`, { token: userA.token })
  check('删除当前默认服务 → 400 且提示先切换',
    deleteDefault.body?.code === 40000 && (deleteDefault.body?.message ?? '').includes('默认'),
    deleteDefault.body?.message)

  const setDefaultNoKey = await api('PUT', `/llm-providers/${byKey.kimi.id}/default`, { token: userA.token })
  check('未配置 Key 的服务设为默认 → 400',
    setDefaultNoKey.body?.code === 40000 && (setDefaultNoKey.body?.message ?? '').includes('API Key'),
    setDefaultNoKey.body?.message)

  const deleteBuiltin = await api('DELETE', `/llm-providers/${byKey.deepseek.id}`, { token: userA.token })
  check('删除内置服务 → 400', deleteBuiltin.body?.code === 40000
    && (deleteBuiltin.body?.message ?? '').includes('内置'), deleteBuiltin.body?.message)

  // 切回 deepseek 后删除 custom（非默认、非内置 → 成功）
  const switchBack = await api('PUT', `/llm-providers/${byKey.deepseek.id}/default`, { token: userA.token })
  check('切回 deepseek 默认成功（其已配置 Key）', switchBack.body?.code === 0,
    switchBack.body?.message)
  const deleted = await api('DELETE', `/llm-providers/${custom.id}`, { token: userA.token })
  check('删除非默认的自定义服务 → 成功', deleted.body?.code === 0, deleted.body?.message)

  // ------------------------------------------------------------ 组 5：连通性测试

  console.log('\n== 组 5：连通性测试（失败返回 ok:false 而非 502） ==')
  const failTest = await api('POST', `/llm-providers/${byKey.kimi.id}/test`, { token: userA.token })
  check('未配置 Key 的测试 → 200 + ok:false + 可读原因',
    failTest.status === 200 && failTest.body?.code === 0
      && failTest.body?.data?.ok === false
      && typeof failTest.body?.data?.message === 'string'
      && failTest.body.data.message.length > 0,
    JSON.stringify(failTest.body?.data))

  const badKeyTest = await api('POST', `/llm-providers/${byKey.deepseek.id}/test`, { token: userA.token })
  check('假 Key 的测试 → 200 + ok:false（不抛 502）',
    badKeyTest.status === 200 && badKeyTest.body?.data?.ok === false,
    `status=${badKeyTest.status} body=${JSON.stringify(badKeyTest.body?.data ?? badKeyTest.body)}`)

  const realKey = readProviderTestKey()
  if (realKey) {
    console.log('  （检测到可用的真实 Key，执行 1 次真实连通性调用）')
    // 把 deepseek 的 Key 换成真实值后再测试（避免误报"假 Key 失败"）
    const configureReal = await api('PUT', `/llm-providers/${byKey.deepseek.id}`, {
      token: userA.token,
      body: { apiKey: realKey },
    })
    check('写入真实 Key 成功（掩码随 Key 变化）',
      configureReal.body?.code === 0 && configureReal.body?.data?.maskedApiKey !== null
        && configureReal.body?.data?.maskedApiKey !== FAKE_KEY
        && !JSON.stringify(configureReal.body?.data).includes(realKey))
    const realTest = await api('POST', `/llm-providers/${byKey.deepseek.id}/test`, { token: userA.token })
    check('真实 Key 的连通性测试 → ok:true 且返回模型名与耗时',
      realTest.body?.data?.ok === true
        && typeof realTest.body?.data?.model === 'string'
        && typeof realTest.body?.data?.latencyMs === 'number',
      JSON.stringify(realTest.body?.data))
  }
  else {
    skip('真实 Key 连通性测试',
      '未找到可用 Key（设置 M14_PROVIDER_TEST_KEY 环境变量，或在 application-local.yml 中填明文 sk- 值后重跑）')
  }

  // ------------------------------------------------------------ 组 6：越权矩阵

  console.log('\n== 组 6：越权矩阵（B 访问 A 的服务 → 全部 404，不产生模型调用） ==')
  const crossUpdate = await api('PUT', `/llm-providers/${byKey.deepseek.id}`, {
    token: userB.token,
    body: { displayName: '越权改名' },
  })
  check('他人服务的更新 → 404', crossUpdate.body?.code === 40400, crossUpdate.body?.message)

  const crossDelete = await api('DELETE', `/llm-providers/${byKey.deepseek.id}`, { token: userB.token })
  check('他人服务的删除 → 404', crossDelete.body?.code === 40400, crossDelete.body?.message)

  const crossTest = await api('POST', `/llm-providers/${byKey.deepseek.id}/test`, { token: userB.token })
  check('他人服务的连通性测试 → 404', crossTest.body?.code === 40400, crossTest.body?.message)

  const crossDefault = await api('PUT', `/llm-providers/${byKey.deepseek.id}/default`, { token: userB.token })
  check('他人服务设为默认 → 404', crossDefault.body?.code === 40400, crossDefault.body?.message)
}

main()
  .then(() => {
    console.log(`\n结果：通过 ${passed} 项，失败 ${failures.length} 项，跳过 ${skipped} 项`)
    if (failures.length) {
      failures.forEach((item) => console.log(`  - ${item}`))
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('脚本异常：', error)
    process.exit(1)
  })
