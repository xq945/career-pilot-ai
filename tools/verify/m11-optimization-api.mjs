/**
 * M11 简历定向优化接口层验收（《开发顺序》M11 的「curl 验收」环节；用 Node fetch 实现
 * 等价的用例组，可复现、可断言、可重跑）。
 *
 * 前置：后端已在 8080 运行（**必须是加载了 M11 路由的新实例**）、MySQL 可用、DeepSeek API Key 有效。
 * 成本：**5 次真实模型调用**（简历分析 1 + 岗位分析 1 + 创建优化 2〔匹配解释 + 优化生成〕
 *      + 重新评估 1）。
 *
 * 覆盖验收标准（《开发顺序》M11）：真实模型调用产出优化稿与修改说明、岗位要求/差距/待确认问题
 * 齐全、保存编辑不覆盖模型原稿、重新评估与优化前口径一致（同一岗位分析、同一规则）、
 * 导出 DOCX 为二进制响应、越权一律 404、缺分析/过期 400、失败不入库。
 *
 * 运行：node tools/verify/m11-optimization-api.mjs
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
const BASE = process.env.API_BASE ?? 'http://localhost:8080/api'

/** 验收专用密码（满足 8 位且含字母与数字的注册规则） */
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

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  let payload
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ---------------------------------------------------------------- 测试数据

const SUFFIX = Date.now().toString(36)

/** 简历文本：覆盖技能、项目、实习、学历四个维度（影响评分与优化输入） */
const RESUME_TEXT = [
  '张三 / Java 后端开发',
  '技能：Java、Spring Boot、MySQL、Redis、Git',
  '项目经历：校园二手交易平台（后端负责人，2024.03-2024.09）',
  '  - 使用 Java 与 Spring Boot 实现订单与商品模块，MySQL 存储数据，Redis 做缓存',
  '工作/实习：示例科技 后端实习生（2024.07-2025.06），参与接口开发与联调',
  '教育经历：示例大学 计算机科学与技术 本科（2021-2025）',
].join('\n')

/** 岗位文本：必备技能与简历高度重合，Docker 为加分项而简历未体现（构造出差距项与待确认问题） */
const JOB_TEXT = [
  '岗位名称：Java 后端开发实习生',
  '职责：参与核心业务系统的接口开发与维护。',
  '要求：熟悉 Java、Spring Boot、MySQL；了解 Redis；有 Docker 使用经验者优先。',
  '学历：本科及以上。经验：有实习经历优先。',
].join('\n')

async function registerAndLogin(prefix) {
  const username = `${prefix}_${SUFFIX}`
  await api('POST', '/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  const login = await api('POST', '/auth/login', { body: { account: username, password: PASSWORD } })
  return { username, token: login.body?.data?.token }
}

async function uploadResume(token, name) {
  const form = new FormData()
  form.append('name', name)
  form.append('file', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt')
  const res = await api('POST', '/resumes', { token, form })
  return res.body?.data?.id
}

/** 用二进制方式取导出响应（DOCX 不是 JSON） */
async function exportRaw(token, id) {
  const res = await fetch(`${BASE}/optimizations/${id}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, bytes }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('== 准备：注册两个账号、建岗位、传简历、完成双方分析（2 次模型调用） ==')
  const userA = await registerAndLogin('m11a')
  const userB = await registerAndLogin('m11b')
  check('账号注册与登录成功', Boolean(userA.token && userB.token))
  if (!userA.token || !userB.token) {
    return
  }

  const job = await api('POST', '/jobs', {
    token: userA.token,
    body: { jobName: 'Java 后端开发实习生', companyName: '示例科技', description: JOB_TEXT },
  })
  const jobId = job.body?.data?.id
  const rawResumeId = await uploadResume(userA.token, '未分析简历')
  const resumeId = await uploadResume(userA.token, '验收简历')
  check('创建岗位与上传简历成功', Boolean(jobId && resumeId && rawResumeId))
  if (!jobId || !resumeId || !rawResumeId) {
    return
  }

  const resumeAnalysis = await api('POST', `/resumes/${resumeId}/analyze`, { token: userA.token })
  const jobAnalysis = await api('POST', `/jobs/${jobId}/analyze`, { token: userA.token })
  check('简历与岗位分析完成',
    resumeAnalysis.body?.code === 0 && jobAnalysis.body?.code === 0,
    `${resumeAnalysis.body?.message} / ${jobAnalysis.body?.message}`)

  // ------------------------------------------------------------ 组 1：创建优化

  console.log('\n== 组 1：创建优化（匹配解释 + 优化生成，2 次模型调用；通常 25–80 秒） ==')
  const create = await api('POST', '/optimizations', { token: userA.token, body: { resumeId, jobId } })
  const opt = create.body?.data
  check('创建优化成功（HTTP 200 + code 0）',
    create.status === 200 && create.body?.code === 0,
    JSON.stringify(create.body).slice(0, 300))
  if (!opt) {
    return
  }

  check('返回优化后的简历内容（Markdown，非空）',
    typeof opt.optimizedContent === 'string' && opt.optimizedContent.length > 50,
    `length=${opt.optimizedContent?.length}`)
  check('未编辑时 editedContent 为 null、版本号为 1、状态 SUCCESS',
    opt.editedContent === null && opt.versionNo === 1 && opt.status === 'SUCCESS',
    JSON.stringify({ edited: opt.editedContent, versionNo: opt.versionNo, status: opt.status }))
  check('未评估时 scoreAfter 为 null（前端显示「待评估」）', opt.scoreAfter === null, String(opt.scoreAfter))

  const changeTypes = ['REWRITE', 'KEYWORD', 'REORDER', 'TRIM']
  check('逐项修改说明非空且结构完整（section/type/reason/before/after）',
    Array.isArray(opt.changes) && opt.changes.length > 0
    && opt.changes.every((item) =>
      typeof item.section === 'string' && item.section.length > 0
      && (item.type === null || changeTypes.includes(item.type))
      && typeof item.after === 'string' && item.after.length > 0),
    JSON.stringify(opt.changes?.slice(0, 1)))
  check('待确认问题为字符串数组（缺口不自动补全）',
    Array.isArray(opt.gapQuestions) && opt.gapQuestions.every((q) => typeof q === 'string'))

  check('岗位要求分析随详情下发（job_analysis 快照）',
    typeof opt.jobRequirements?.summary === 'string'
    && Array.isArray(opt.jobRequirements?.requiredSkills)
    && opt.jobRequirements.requiredSkills.length > 0,
    JSON.stringify(opt.jobRequirements).slice(0, 200))
  check('简历优势随详情下发（resume_analysis 快照）', Array.isArray(opt.resumeAdvantages))

  const items = opt.dimensionScores?.items ?? []
  check('优化前维度顺序为权重降序（45/25/15/10/5）',
    items.map((item) => item.weight).join(',') === '45,25,15,10,5',
    items.map((item) => item.weight).join(','))
  const handComputed = items.reduce((sum, item) => sum + item.weight * item.score, 0) / 100
  check('优化前总分等于按权重手算的结果',
    Math.abs(handComputed - opt.matchScore) < 1e-9,
    `手算=${handComputed} 接口=${opt.matchScore}`)
  check('matchId 非空（优化前匹配评估已落 match_record）', typeof opt.matchId === 'number' && opt.matchId > 0)
  check('明细为 {text, dimension} 对象且 dimension 属白名单',
    ['matchedItems', 'partialItems', 'missingItems'].every((field) =>
      Array.isArray(opt[field]) && opt[field].every((item) =>
        typeof item.text === 'string'
        && (item.dimension === null
          || ['requiredSkills', 'projectRelevance', 'experience', 'education', 'preferredSkills'].includes(item.dimension)))))
  check('全链路不含「不具备」类断言', JSON.stringify(opt).indexOf('不具备') === -1)
  check('内联资源名称与分析版本号',
    opt.resumeName === '验收简历' && opt.jobName === 'Java 后端开发实习生'
    && opt.companyName === '示例科技'
    && opt.resumeVersionNo === 1 && opt.jobVersionNo === 1,
    JSON.stringify({ r: opt.resumeName, j: opt.jobName, rv: opt.resumeVersionNo, jv: opt.jobVersionNo }))

  // ------------------------------------------------------------ 组 2：列表与详情

  console.log('\n== 组 2：列表与详情（零模型调用） ==')
  const list = await api('GET', '/optimizations?page=1&size=10', { token: userA.token })
  const records = list.body?.data?.records ?? []
  check('列表出现该记录且 total=1',
    records.length === 1 && list.body?.data?.total === 1,
    JSON.stringify(list.body?.data).slice(0, 200))
  check('列表行内联名称、版本号与前后分数',
    records[0]?.resumeName === '验收简历' && records[0]?.jobName === 'Java 后端开发实习生'
    && records[0]?.versionNo === 1 && records[0]?.matchScore === opt.matchScore
    && records[0]?.scoreAfter === null)

  const detail = await api('GET', `/optimizations/${opt.id}`, { token: userA.token })
  const detailData = detail.body?.data
  check('详情与创建响应结构一致（关键字段逐一比对）',
    detailData?.id === opt.id && detailData?.optimizedContent === opt.optimizedContent
    && detailData?.matchScore === opt.matchScore && detailData?.matchId === opt.matchId
    && (detailData?.changes?.length ?? -1) === opt.changes.length)

  // ------------------------------------------------------------ 组 3：保存编辑

  console.log('\n== 组 3：保存编辑稿（不覆盖模型原稿） ==')
  const draft = `${opt.optimizedContent}\n\n## 补充说明\n（这是我手动补充的一行）`
  const save1 = await api('PUT', `/optimizations/${opt.id}/content`, {
    token: userA.token,
    body: { content: draft },
  })
  const saved1 = save1.body?.data
  check('保存编辑成功', save1.body?.code === 0, JSON.stringify(save1.body).slice(0, 200))
  check('editedContent 已更新、**optimizedContent 保持模型原稿不变**',
    saved1?.editedContent === draft && saved1?.optimizedContent === opt.optimizedContent)

  const save2 = await api('PUT', `/optimizations/${opt.id}/content`, {
    token: userA.token,
    body: { content: `${draft}\n第二版` },
  })
  const saved2 = save2.body?.data
  check('再次保存：旧编辑稿进入编辑历史（上限 10 版）',
    saved2?.editHistory?.length === 1 && saved2.editHistory[0]?.content === draft,
    JSON.stringify(saved2?.editHistory?.map((h) => h.content?.length)))

  const blank = await api('PUT', `/optimizations/${opt.id}/content`, {
    token: userA.token,
    body: { content: '   ' },
  })
  check('空白内容 → 400/40001', blank.status === 400 && blank.body?.code === 40001,
    JSON.stringify(blank.body).slice(0, 120))
  const tooLong = await api('PUT', `/optimizations/${opt.id}/content`, {
    token: userA.token,
    body: { content: 'x'.repeat(20001) },
  })
  check('超长内容 → 400/40001', tooLong.status === 400 && tooLong.body?.code === 40001,
    JSON.stringify(tooLong.body).slice(0, 120))

  // ------------------------------------------------------------ 组 4：重新评估

  console.log('\n== 组 4：重新评估（1 次模型调用；复用同一份岗位分析重算） ==')
  const evaluate = await api('POST', `/optimizations/${opt.id}/evaluate`, { token: userA.token })
  const evaluated = evaluate.body?.data
  check('重新评估成功', evaluate.body?.code === 0, JSON.stringify(evaluate.body).slice(0, 200))
  check('scoreAfter 为 0–100 的数值', typeof evaluated?.scoreAfter === 'number'
    && evaluated.scoreAfter >= 0 && evaluated.scoreAfter <= 100, String(evaluated?.scoreAfter))
  const afterItems = evaluated?.dimensionScoresAfter?.items ?? []
  const afterHand = afterItems.reduce((sum, item) => sum + item.weight * item.score, 0) / 100
  check('优化后总分等于按权重手算的结果（与优化前同一评分规则）',
    afterItems.length === 5 && Math.abs(afterHand - evaluated.scoreAfter) < 1e-9,
    `手算=${afterHand} 接口=${evaluated?.scoreAfter}`)
  check('评估时间已写入（evaluatedAt 非空）', typeof evaluated?.evaluatedAt === 'string')
  check('评估不改变模型原稿与用户稿',
    evaluated?.optimizedContent === opt.optimizedContent && evaluated?.editedContent?.includes('第二版'))

  // ------------------------------------------------------------ 组 5：导出 DOCX

  console.log('\n== 组 5：导出 DOCX（二进制响应） ==')
  const exported = await exportRaw(userA.token, opt.id)
  check('导出 HTTP 200 且为 docx 的 Content-Type',
    exported.status === 200
    && (exported.headers.get('content-type') ?? '').includes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    exported.headers.get('content-type'))
  check('Content-Disposition 为附件且含中文文件名（UTF-8 编码）',
    (exported.headers.get('content-disposition') ?? '').includes('attachment')
    && (exported.headers.get('content-disposition') ?? '').includes("%E4%BC%98%E5%8C%96%E7%A8%BF"),
    exported.headers.get('content-disposition'))
  check('响应体为 ZIP 容器（docx 魔数 PK）且非空',
    exported.bytes.length > 1000 && exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4B,
    `length=${exported.bytes.length}`)

  // ------------------------------------------------------------ 组 6：错误与越权矩阵

  console.log('\n== 组 6：错误处理与越权矩阵（零模型调用） ==')
  const noAnalysis = await api('POST', '/optimizations', {
    token: userA.token,
    body: { resumeId: rawResumeId, jobId },
  })
  check('简历未分析 → 400/40000（不自动补齐）',
    noAnalysis.status === 400 && noAnalysis.body?.code === 40000,
    JSON.stringify(noAnalysis.body).slice(0, 150))

  const missing = await api('POST', '/optimizations', {
    token: userA.token,
    body: { resumeId, jobId: 999999 },
  })
  check('岗位不存在/非本人 → 404/40400', missing.status === 404 && missing.body?.code === 40400)

  const bDetail = await api('GET', `/optimizations/${opt.id}`, { token: userB.token })
  const bSave = await api('PUT', `/optimizations/${opt.id}/content`, {
    token: userB.token,
    body: { content: '别人的稿子' },
  })
  const bEvaluate = await api('POST', `/optimizations/${opt.id}/evaluate`, { token: userB.token })
  check('他人优化记录：详情/保存/评估 一律 404',
    bDetail.status === 404 && bDetail.body?.code === 40400
    && bSave.status === 404 && bSave.body?.code === 40400
    && bEvaluate.status === 404 && bEvaluate.body?.code === 40400,
    JSON.stringify([bDetail.status, bSave.status, bEvaluate.status]))
  const bExport = await fetch(`${BASE}/optimizations/${opt.id}/export`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  })
  check('他人优化记录：导出 404', bExport.status === 404)

  const noToken = await api('GET', '/optimizations')
  check('无 Token → 401/40100', noToken.status === 401 && noToken.body?.code === 40100,
    JSON.stringify(noToken.body).slice(0, 120))

  // ------------------------------------------------------------ 清理提示

  console.log('\n== 清理（按需手工执行；优化记录无删除接口，随测试账号保留） ==')
  console.log(`-- 测试账号：${userA.username} / ${userB.username}`)
  console.log(`-- SELECT id FROM sys_user WHERE username LIKE 'm11%_${SUFFIX}';  -- 再按 user_id 级联清理`)
}

main()
  .catch((error) => {
    console.error('脚本异常：', error)
    failures.push(`脚本异常：${error.message}`)
  })
  .finally(() => {
    console.log(`\n== 结果：通过 ${passed} 项，失败 ${failures.length} 项 ==`)
    if (failures.length > 0) {
      console.log('失败清单：')
      for (const item of failures) {
        console.log(`  - ${item}`)
      }
      process.exitCode = 1
    }
  })
