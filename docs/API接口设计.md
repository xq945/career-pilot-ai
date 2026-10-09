# 智能求职辅助平台：API 接口设计

- 文档版本：V1.2
- 修订日期：2026-10-09
- 基础路径：`/api`
- 协议：HTTP/HTTPS + JSON；简历上传使用 `multipart/form-data`
- 认证：除注册、登录外，默认要求 JWT
- 约定：接口仅返回当前用户有权访问的数据；所有 ID 都需要做服务端归属校验。
- 修订说明：
  - V1.1：依据《设计审查报告》修订，统一异常状态码、消除面试接口歧义、明确分析结果缺失与失败时的返回、补充 Agent 会话接口结构
  - V1.2：第二轮审查整改，明确简历原文不提供下载（G-9）、`generatedCount` 来源（G-3）、面试报告响应结构（G-4）、Agent 可选参数（G-5）、历史版本范围（G-6）、删除后关联记录可见性（G-7）

---

## 1. 统一响应格式

成功：

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "timestamp": "2026-10-09T10:00:00"
}
```

失败：

```json
{
  "code": 40001,
  "message": "请求参数不合法",
  "data": null,
  "timestamp": "2026-10-09T10:00:00"
}
```

业务错误码：

| HTTP | 业务码 | 含义 | 说明 |
|---|---:|---|---|
| 400 | 40000 | 通用参数错误 | — |
| 400 | 40001 | 参数校验失败 | Bean Validation 错误，`data` 中可携带字段级信息 |
| 401 | 40100 | 未登录或 Token 无效 | 不区分具体原因 |
| 403 | 40300 | 无权访问 | 或按安全策略统一返回 404 |
| 404 | 40400 | 资源不存在 | — |
| 413 | 41300 | 文件过大 | 需全局处理 `MaxUploadSizeExceededException` |
| 415 | 41500 | 文件类型不支持 | 扩展名、MIME、文件魔数三者均需校验 |
| 429 | 42900 | 请求过于频繁 | 仅当实现了限流时才返回，否则移除该码 |
| 502 | 50200 | 大模型服务暂不可用 | 超时或不可用，可重试 |
| 502 | 50201 | 大模型输出无法解析 | 未保存任何结果，可重试 |
| 500 | 50000 | 服务内部错误 | — |

**状态码统一说明**：V1.0 中系统架构文档写"文件格式不支持返回 400"，与本表的 415 冲突，V1.1 统一为 **415**。

不要将 Java 异常堆栈、API Key、SQL 或本机文件路径放进响应。

---

## 2. JWT 与跨域约定

登录成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "<jwt>",
    "tokenType": "Bearer",
    "expiresIn": 7200,
    "user": {
      "id": 1,
      "username": "student01",
      "nickname": "求职者"
    }
  },
  "timestamp": "2026-10-09T10:00:00"
}
```

前端请求头：

```http
Authorization: Bearer <jwt>
```

约定：

- JWT 使用 HS256 算法，密钥不少于 32 字节，过期时间示例为 2 小时（可配置）。
- JWT 不应包含密码或完整简历内容。
- **Token 存储位置：前端 `localStorage`**。认证使用 `Authorization` 头而非 Cookie，因此不需要 CSRF 防护。
- 退出登录由前端清除 Token 完成；服务端不实现 Token 撤销机制，接口文档中不得声称服务端已使 Token 失效。
- **CORS**：开发环境允许 `http://localhost:5173`；生产环境同源部署后关闭跨域。详见系统架构设计文档第 7.2 节。

---

## 3. 认证与用户接口

### 3.1 注册

`POST /api/auth/register`（公开）

请求：

```json
{
  "username": "student01",
  "email": "student01@example.com",
  "password": "AtLeast8Chars!"
}
```

校验：

- 用户名与邮箱均唯一；
- **密码长度不少于 8 位，且同时包含字母与数字**；
- 密码以 BCrypt 哈希保存。

### 3.2 登录

`POST /api/auth/login`（公开）

请求：

```json
{
  "account": "student01",
  "password": "AtLeast8Chars!"
}
```

`account` 可按实现支持用户名或邮箱。

### 3.3 当前用户资料

`GET /api/user/profile`

响应 data：

```json
{
  "id": 1,
  "username": "student01",
  "email": "student01@example.com",
  "nickname": "求职者",
  "avatar": null
}
```

### 3.4 更新资料

`PUT /api/user/profile`

请求：

```json
{
  "nickname": "求职者",
  "avatar": null
}
```

### 3.5 退出登录

`POST /api/auth/logout`

未实现服务端 Token 撤销，该接口仅表示客户端应清除本地 Token，服务端不使 Token 失效。

---

## 4. 简历接口

### 4.1 上传简历

`POST /api/resumes`，`multipart/form-data`

字段：

- `file`：必填，PDF 或 DOCX。
- `name`：可选，用户自定义简历名称（缺省取原文件名）。

限制与校验：

- 单文件不超过 10 MB；超过返回 **413 / 41300**。
- 后端依次校验**扩展名、MIME、文件魔数**，任一不符返回 **415 / 41500**。
- 文本提取失败或提取结果为空/过短时，拒绝入库并返回 400，提示用户上传可复制文本的 PDF。
- 提取文本超过 20000 字符时截断后入库。

成功响应 data：

```json
{
  "id": 101,
  "name": "Java后端简历",
  "fileName": "resume.pdf",
  "fileType": "PDF",
  "textExtracted": true,
  "createdAt": "2026-10-09T10:00:00"
}
```

不返回服务端存储路径。

### 4.2 简历列表

`GET /api/resumes?page=1&size=10`

仅返回当前用户的**有效**简历（`status = 1`）。

响应 data：

```json
{
  "records": [
    {
      "id": 101,
      "name": "Java后端简历",
      "fileType": "PDF",
      "createdAt": "2026-10-09T10:00:00"
    }
  ],
  "page": 1,
  "size": 10,
  "total": 1
}
```

### 4.3 简历详情

`GET /api/resumes/{id}`

只返回元数据，**不返回**提取的简历文本。

**范围约定（G-9）**：第一版**不提供简历原文的预览与下载接口**。简历文本仅在服务端用于 AI 分析，不回流到前端。如后续确有需要，应另设独立接口，并按第 9 节的长度上限约定限制返回长度。

### 4.4 删除简历

`DELETE /api/resumes/{id}`

- 校验归属；
- 执行**逻辑删除**（`status = 0`）；
- 同步**物理删除**磁盘上的简历文件；
- 重复删除返回成功（幂等）。

**删除后关联数据的可见性（G-7）**：

- 该简历的**分析记录、匹配记录、面试记录仍然保留且可正常查询**（历史可追溯，不做级联删除）；
- 但简历本身不再出现在简历列表中，`GET /api/resumes/{id}` 返回 404；
- 因此前端在匹配/面试记录中跳转源简历时可能遇到 404，**前端须对此给出提示**（如"关联简历已删除"），后端响应结构不做特殊字段扩展。

岗位删除（5.5）采用相同规则。

### 4.5 发起简历分析

`POST /api/resumes/{id}/analyze`

请求体可为空。

行为：

- 校验归属；简历文本为空则返回 400；
- 计算当前简历文本的 SHA-256，与最新成功分析的 `source_hash` 比对：**一致则直接返回已有结果，不重复调用模型**；
- 否则调用模型生成新版本（`version_no` 递增）；
- 模型超时/不可用返回 **502 / 50200**；输出无法解析返回 **502 / 50201**；
- 失败时**不写入任何分析记录**，仅记录脱敏日志。

成功响应 data：

```json
{
  "analysisId": 501,
  "resumeId": 101,
  "versionNo": 1,
  "status": "SUCCESS",
  "summary": "简历包含 Java 后端项目经验……",
  "skills": [
    {"name": "Java", "level": "已体现", "evidence": "项目经历中提及"}
  ],
  "advantages": ["包含后端项目经历"],
  "weaknesses": ["部分项目成果缺少量化指标"],
  "suggestions": ["补充项目规模、个人职责和实际结果"]
}
```

### 4.6 获取简历分析

`GET /api/resumes/{id}/analysis`

- 返回该简历最新成功分析结果。
- **无分析结果时返回 HTTP 200**，`code = 0`，data 为：

```json
{
  "analyzed": false,
  "analysis": null
}
```

有结果时 `analyzed` 为 `true`，`analysis` 为第 4.5 节所示结构。

**范围约定（G-6）**：该接口只返回**最新一版**成功分析。分析结果虽然按 `version_no` 保留多版本，但第一版**不提供历史版本列表或指定版本查询接口**——版本机制用于服务端的复用判断与数据追溯，不作为面向用户的功能。

> 说明：V1.0 中"返回 404 或 NOT_ANALYZED 状态，保持全项目一致"未定死。V1.1 统一为 **200 + `analyzed` 标志位**，避免前端将"未分析"误判为错误。岗位分析接口（5.7）采用同一约定。

---

## 5. 岗位接口

### 5.1 创建岗位

`POST /api/jobs`

请求：

```json
{
  "companyName": "示例科技",
  "jobName": "Java后端开发实习生",
  "description": "岗位职责与任职要求的完整文本……"
}
```

校验：`jobName` 必填；`description` 必填且不超过 10000 字符。

### 5.2 岗位列表

`GET /api/jobs?page=1&size=10`

仅返回当前用户的有效岗位。

### 5.3 岗位详情

`GET /api/jobs/{id}`

### 5.4 更新岗位

`PUT /api/jobs/{id}`

请求：

```json
{
  "companyName": "示例科技",
  "jobName": "Java后端开发实习生",
  "description": "更新后的岗位描述……"
}
```

**岗位描述更新后的处理**：旧分析的 `source_hash` 与最新描述不一致，即视为**已过期**。再调用分析接口时生成新版本；前端展示层面提示"当前分析基于旧版岗位描述"。

### 5.5 删除岗位

`DELETE /api/jobs/{id}`

逻辑删除（`status = 0`），关联分析记录保留。重复删除返回成功（幂等）。

### 5.6 发起岗位分析

`POST /api/jobs/{id}/analyze`

行为与简历分析一致（归属校验、`source_hash` 复用判断、失败不入库）。

成功响应 data：

```json
{
  "analysisId": 601,
  "jobId": 201,
  "versionNo": 1,
  "status": "SUCCESS",
  "responsibilities": ["开发后端接口"],
  "requiredSkills": ["Java", "Spring Boot", "MySQL"],
  "preferredSkills": ["Redis", "Docker"],
  "technologyStack": ["Java", "Spring Boot", "MySQL"],
  "educationRequirement": "按岗位描述提取",
  "experienceRequirement": "按岗位描述提取",
  "summary": "该岗位重点关注 Java 后端开发能力"
}
```

### 5.7 获取岗位分析

`GET /api/jobs/{id}/analysis`

无分析结果时与 4.6 采用相同约定（200 + `analyzed: false`）。

---

## 6. 匹配接口

### 6.1 创建匹配分析

`POST /api/matches`

请求：

```json
{
  "resumeId": 101,
  "jobId": 201
}
```

行为：

- 校验简历与岗位均属于当前用户；
- 读取双方最新成功分析；缺失时任一方无分析结果则返回 400，提示先完成分析（由 Agent 调用时例外，见 Agent 设计文档 4.4）；
- 由后端按固定权重计算分数，模型仅生成解释与建议；
- **每次调用创建一条新的匹配记录**（保留历史，便于对比简历修改效果）。

响应 data：

```json
{
  "id": 701,
  "resumeId": 101,
  "jobId": 201,
  "matchScore": 76.5,
  "matchedItems": ["Java", "Spring Boot"],
  "partialItems": ["项目部署经验"],
  "missingItems": ["岗位要求 Docker，简历未体现相关证据"],
  "dimensionScores": {
    "requiredSkills": 80,
    "projectRelevance": 75,
    "experience": 70,
    "education": 80,
    "preferredSkills": 50
  },
  "suggestions": ["补充项目部署经历；若没有相关经验，可先完成一个 Docker 部署练习"]
}
```

注意：缺少简历证据不等同于用户一定不具备该能力。响应应使用"简历未体现"或"缺少相关证据"等表述。

### 6.2 匹配记录列表

`GET /api/matches?page=1&size=10`

### 6.3 匹配报告详情

`GET /api/matches/{id}`

---

## 7. AI 面试接口

### 7.1 创建面试会话（含生成题目）

`POST /api/interviews`

请求：

```json
{
  "jobId": 201,
  "title": "Java后端岗位模拟面试",
  "questionType": "MIXED",
  "questionCount": 5
}
```

约束：

- `jobId` 必须属于当前用户；
- 允许的 `questionType`：`JAVA`、`SPRING`、`MYSQL`、`REDIS`、`PROJECT`、`MIXED`（白名单枚举）；
- `questionCount` 取值范围 1～20。

行为：

- **题目在创建会话时一次性生成**，会话与题目在同一事务内落库；生成失败则整体失败，不产生无题目的空会话。
- 生成结果需结构化校验：过滤空题与重复题；实际题目数少于请求数时以实际为准，并通过响应告知。

响应 data：

```json
{
  "id": 801,
  "title": "Java后端岗位模拟面试",
  "questionType": "MIXED",
  "questionCount": 5,
  "generatedCount": 5,
  "status": 0,
  "createdAt": "2026-10-09T10:00:00",
  "questions": [
    {"id": 9001, "question": "请解释 Spring 的依赖注入……", "questionCategory": "SPRING", "sortOrder": 1}
  ]
}
```

**字段来源说明（G-3）**：`questionCount` 是请求中的**计划**题目数，持久化在 `interview_session.question_count`；`generatedCount` 是**实际**生成并通过校验的题目数，**不单独落库**，由该会话的题目行数（`COUNT(interview_question)`）统计得出。两者可能不同（生成结果去重或不足时以实际为准）。

> 说明：V1.0 中创建会话传 `questionCount`、另有独立接口 `POST /api/interviews/{id}/questions` 又传 `count`，两个来源语义重叠。V1.1 取消该独立接口，题目随会话一次生成，`question_count` 表示计划题目数。

### 7.2 提交回答并评价

`POST /api/interviews/{id}/questions/{questionId}/answer`

请求：

```json
{
  "answer": "我的回答内容……"
}
```

行为：

- 校验会话与题目归属；
- 校验会话处于"进行中"状态；
- 同一题目重复提交则覆盖上一次回答与评价（幂等）。

响应 data：

```json
{
  "questionId": 9001,
  "score": 78,
  "analysis": "回答覆盖了核心概念，但对事务隔离级别的解释不够完整。",
  "referenceAnswer": "参考答案……",
  "suggestions": ["补充具体场景", "说明底层实现原理"]
}
```

### 7.3 面试列表与详情

- `GET /api/interviews?page=1&size=10`
- `GET /api/interviews/{id}`：包含会话信息与全部题目（含已提交的回答与评价）
- `GET /api/interviews/{id}/report`：汇总报告（响应结构见 7.4）

所有接口都需要校验会话和题目归属。

### 7.4 面试报告结构与总分

`GET /api/interviews/{id}/report` 响应 data：

```json
{
  "sessionId": 801,
  "title": "Java后端岗位模拟面试",
  "status": 0,
  "questionCount": 5,
  "answeredCount": 3,
  "completed": false,
  "totalScore": null,
  "categoryScores": [
    {"category": "SPRING", "averageScore": 78.0, "questionCount": 2}
  ],
  "questions": [
    {"questionId": 9001, "question": "请解释 Spring 的依赖注入……", "score": 78, "answered": true}
  ]
}
```

字段说明：

- `completed`：全部题目均已作答时为 `true`；
- `answeredCount`：已作答题目数；
- `totalScore`：**仅在 `completed = true` 时有值**，为各题得分的平均值（保留两位小数），未作答题目不计入；
- `categoryScores`：按题目的 `question_category` 分组统计，仅统计已作答题目。

总分与完成规则：

- **总分计算时机**：会话内全部题目均已作答时，服务端计算并写入 `interview_session.total_score`，同时将会话状态置为 `1`（已完成）；
- 会话未完成时，报告接口返回部分统计，`completed` 为 `false`、`totalScore` 为 `null`；
- 第一版不提供"取消面试"接口；会话状态中的 `2`（已取消）保留备用。

---

## 8. Agent 接口

### 8.1 Agent 对话

`POST /api/agent/chat`

请求：

```json
{
  "sessionId": "可选；首次请求可省略，由服务端生成并返回",
  "message": "请分析我的简历是否适合目标岗位",
  "resumeId": 101,
  "jobId": 201
}
```

**参数说明（G-5）**：

- `message`：必填，用户输入，长度不超过 2000 字符。
- `sessionId`：可选。首次对话省略，由服务端生成并返回；后续请求携带以延续上下文。服务端须校验该会话属于当前用户。
- `resumeId`、`jobId`：**均可选**，用于给本次对话指定上下文资源（用户可在界面上选中某份简历或某个岗位后再提问）。省略时 Agent 只能基于用户输入与已有会话历史作答，需要具体资源时应向用户询问或由用户补充。
- **一旦提供，后端必须校验其是否属于当前用户**，校验失败返回 403/404，不得进入模型调用。
- Agent 只能调用已注册且经过授权的工具。
- 单次请求受最大工具调用次数与总超时约束（建议：工具调用不超过 5 次，总时长不超过 120 秒）。
- 第一版采用**非流式**响应。

响应 data：

```json
{
  "sessionId": "agent-session-uuid",
  "message": "从简历与岗位要求来看……",
  "toolCalls": [
    {"toolName": "analyzeResume", "status": "SUCCESS"},
    {"toolName": "analyzeJob", "status": "SUCCESS"},
    {"toolName": "matchResumeToJob", "status": "SUCCESS"}
  ]
}
```

工具调用记录由应用层包装记录（通过 Spring AI 的工具调用拦截/监听机制），不依赖模型自行报告。

### 8.2 会话列表

`GET /api/agent/sessions?page=1&size=10`

只能查询当前用户的会话。响应 data：

```json
{
  "records": [
    {
      "sessionId": "agent-session-uuid",
      "title": "请分析我的简历是否适合目标岗位",
      "createdAt": "2026-10-09T10:00:00",
      "updatedAt": "2026-10-09T10:05:00"
    }
  ],
  "page": 1,
  "size": 10,
  "total": 3
}
```

按 `updated_at` 倒序排列。会话元数据来自 `agent_session` 表。

### 8.3 会话消息

`GET /api/agent/sessions/{sessionId}`

只能查询当前用户的会话。响应 data：

```json
{
  "sessionId": "agent-session-uuid",
  "title": "请分析我的简历是否适合目标岗位",
  "messages": [
    {"role": "user", "content": "请分析我的简历是否适合目标岗位", "createdAt": "2026-10-09T10:00:00"},
    {"role": "tool", "toolName": "analyzeResume", "status": "SUCCESS", "createdAt": "2026-10-09T10:00:05"},
    {"role": "assistant", "content": "从简历与岗位要求来看……", "createdAt": "2026-10-09T10:00:12"}
  ]
}
```

- 消息内容涉及简历隐私，接口需做访问控制。
- 工具消息**不返回**原始入参与结果（可能包含大段简历文本），仅返回工具名与执行状态。
- 第一版不分页，会话消息数量由工具调用上限自然约束。

---

## 9. 分页、排序和校验约定

- 页码从 1 开始，默认 `size=10`，最大值 100。
- 列表只返回当前用户数据。
- 排序字段使用后端白名单，不能直接拼接前端传入的 SQL 排序内容。
- 请求体文本字段设置长度上限（岗位描述 10000 字符、面试回答 5000 字符），防止超长 Prompt。
- 所有请求 DTO 使用 Bean Validation。
- 更新和删除采用幂等、明确的业务规则。
- 对耗时 AI 操作设置超时，并为前端提供加载、失败和重试状态。
- 所有 AI 相关接口在超时或输出异常时返回 502 系列错误码，前端据此展示"重试"入口。
