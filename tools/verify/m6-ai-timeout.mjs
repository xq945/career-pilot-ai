/**
 * M6 接口层验收 · 组 3：AI 异常链路（模型读超时 → 50200 且不入库）。
 *
 * 与 m6-match-api.mjs 分开的原因：本组需要后端**刻意以短读超时启动**，属于一次性验证手法——
 *   java -jar target/career-pilot-server-0.0.1-SNAPSHOT.jar --spring.http.clients.read-timeout=1s
 * 验证完成后须用正常配置重启。手法与《测试与验收方案》2.3 一致（M5 曾用于岗位分析）。
 *
 * 依赖：演示账号存在一份「已分析」的简历与一个「已分析且未过期」的岗位（tools/seed/demo-data.mjs）。
 * 成本：1 次"失败"的模型调用（上游可能已处理，按实际计费为准）。
 *
 * 运行：node tools/verify/m6-ai-timeout.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'
const ACCOUNT = process.env.VERIFY_ACCOUNT ?? 'demo'
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'demo1234'

async function api(method, path, { token, body } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

async function main() {
  const login = await api('POST', '/auth/login', { body: { account: ACCOUNT, password: PASSWORD } })
  const token = login.body?.data?.token
  console.log(`登录演示账号 ${ACCOUNT}：${token ? '成功' : '失败'}`)
  if (!token) {
    process.exitCode = 1
    return
  }

  const resumes = await api('GET', '/resumes?page=1&size=100', { token })
  const resume = (resumes.body?.data?.records ?? []).find((record) => record.analyzed)
  const jobs = await api('GET', '/jobs?page=1&size=100', { token })
  const job = (jobs.body?.data?.records ?? []).find((record) => record.analyzed && !record.stale)
  console.log(`选中资源：resumeId=${resume?.id}（已分析） jobId=${job?.id}（已分析且未过期）`)
  if (!resume || !job) {
    console.log('[FAIL] 缺少可用的已分析资源，请先运行 tools/seed/demo-data.mjs')
    process.exitCode = 1
    return
  }

  const totalBefore = (await api('GET', '/matches?page=1&size=10', { token })).body?.data?.total

  const started = Date.now()
  const created = await api('POST', '/matches', { token, body: { resumeId: resume.id, jobId: job.id } })
  const elapsed = Date.now() - started

  const timeoutOk = created.status === 502 && created.body?.code === 50200
  console.log(`${timeoutOk ? '[OK]' : '[FAIL]'} 模型读超时 → 502 / 50200（耗时 ${elapsed}ms，`
    + `实际 status=${created.status} code=${created.body?.code} message=${created.body?.message}）`)

  const totalAfter = (await api('GET', '/matches?page=1&size=10', { token })).body?.data?.total
  const unchanged = totalAfter === totalBefore
  console.log(`${unchanged ? '[OK]' : '[FAIL]'} 失败不入库（匹配记录 total ${totalBefore} → ${totalAfter}）`)

  process.exitCode = timeoutOk && unchanged ? 0 : 1
}

main().catch((error) => {
  console.error('脚本异常：', error)
  process.exitCode = 1
})
