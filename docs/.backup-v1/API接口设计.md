# 智能求职辅助平台：API 接口设计

- 文档版本：V1.0
- 基础路径：`/api`
- 协议：HTTP/HTTPS + JSON；简历上传使用 `multipart/form-data`
- 认证：除注册、登录外，默认要求 JWT
- 约定：接口仅返回当前用户有权访问的数据；所有 ID 都需要做服务端归属校验。

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

建议业务错误码：

| HTTP | 业务码 | 含义 |
|---|---:|---|
| 400 | 40000 | 通用参数错误 |
| 400 | 40001 | 参数校验失败 |
| 401 | 40100 | 未登录或 Token 无效 |
| 403 | 40300 | 无权访问 |
| 404 | 40400 | 资源不存在 |
| 413 | 41300 | 文件过大 |
| 415 | 41500 | 文件类型不支持 |
| 429 | 42900 | 请求过于频繁 |
| 502 | 50200 | 大模型服务暂不可用 |
| 500 | 50000 | 服务内部错误 |

不要将 Java 异常堆栈、API Key、SQL 或本机文件路径放进响应。

## 2. JWT 约定

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

JWT 过期时间示例为 2 小时，可配置。JWT 不应包含密码或完整简历内容。若采用无状态 JWT，退出登录可以先由前端删除 Token；若需要立即撤销 Token，则需额外设计服务端撤销机制。

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

校验：用户名和邮箱唯一；密码满足项目设定的长度规则；密码以 BCrypt 哈希保存。

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

若未实现服务端 Token 撤销，接口说明应明确退出操作由客户端清除 Token 完成；不能声称服务端已经使 Token 失效。

## 4. 简历接口

### 4.1 上传简历

`POST /api/resumes`，`multipart/form-data`

字段：

- `file`：必填，PDF 或 DOCX。
- `name`：可选，用户自定义简历名称。

限制建议：单文件不超过 10 MB；后端校验扩展名、MIME、文件内容和文本提取结果。

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

不返回 `file_path` 的服务器绝对路径。

### 4.2 简历列表

`GET /api/resumes?page=1&size=10`

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

默认只返回元数据；若确实需要展示提取文本，应提供单独字段并限制返回长度。

### 4.4 删除简历

`DELETE /api/resumes/{id}`

必须校验归属。按项目确定的逻辑删除策略处理文件和关联记录。

### 4.5 发起简历分析

`POST /api/resumes/{id}/analyze`

请求可为空。后端读取简历文本，调用 AI 服务，校验输出并保存新的分析版本。

响应 data：

```json
{
  "analysisId": 501,
  "resumeId": 101,
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

### 4.6 获取最新简历分析

`GET /api/resumes/{id}/analysis`

返回该简历最新成功分析结果。若无分析结果，返回 404 或明确的 `NOT_ANALYZED` 业务状态，保持全项目一致。

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

### 5.2 岗位列表

`GET /api/jobs?page=1&size=10`

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

岗位描述更新后，旧岗位分析应标记为过期或生成新的分析版本。

### 5.5 删除岗位

`DELETE /api/jobs/{id}`

校验资源归属，并按约定执行逻辑删除或关联数据处理。

### 5.6 发起岗位分析

`POST /api/jobs/{id}/analyze`

响应 data：

```json
{
  "analysisId": 601,
  "jobId": 201,
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

响应 data：

```json
{
  "id": 701,
  "resumeId": 101,
  "jobId": 201,
  "matchScore": 76.5,
  "matchedItems": ["Java", "Spring Boot"],
  "partialItems": ["项目部署经验"],
  "missingItems": ["岗位要求 Docker，但简历没有相关证据"],
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

注意：缺少简历证据不等同于用户一定不具备该能力。响应应使用“简历未体现”或“缺少相关证据”等表述。

### 6.2 匹配记录列表

`GET /api/matches?page=1&size=10`

### 6.3 匹配报告详情

`GET /api/matches/{id}`

## 7. AI 面试接口

### 7.1 创建面试会话

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

建议允许的 `questionType`：`JAVA`、`SPRING`、`MYSQL`、`REDIS`、`PROJECT`、`MIXED`。题目数量设置合理上限，例如 1～20。

### 7.2 生成题目

`POST /api/interviews/{id}/questions`

请求：

```json
{
  "questionType": "MIXED",
  "count": 5
}
```

### 7.3 提交回答并评价

`POST /api/interviews/{id}/questions/{questionId}/answer`

请求：

```json
{
  "answer": "我的回答内容……"
}
```

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

### 7.4 面试列表与详情

- `GET /api/interviews?page=1&size=10`
- `GET /api/interviews/{id}`
- `GET /api/interviews/{id}/report`

所有接口都需要校验会话和题目归属。

## 8. Agent 接口

### 8.1 Agent 对话

`POST /api/agent/chat`

请求：

```json
{
  "sessionId": "可选；首次请求可省略",
  "message": "请分析我的简历是否适合目标岗位",
  "resumeId": 101,
  "jobId": 201
}
```

后端应校验 `resumeId` 和 `jobId` 是否属于当前用户。Agent 只能调用已注册且经过授权的工具。

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

如果具体 Spring AI 版本无法直接提供统一的工具调用记录，可由应用层包装记录，不要依赖不存在的 API。

### 8.2 会话列表

`GET /api/agent/sessions?page=1&size=10`

### 8.3 会话消息

`GET /api/agent/sessions/{sessionId}`

只能查询当前用户的会话。消息内容涉及简历隐私，接口需做访问控制。

## 9. 分页、排序和校验约定

- 页码从 1 开始，默认 `size=10`，最大值建议 100。
- 列表只返回当前用户数据。
- 排序字段使用后端白名单，不能直接拼接前端传入的 SQL 排序内容。
- 文本字段设置合理长度上限，防止超长 Prompt。
- 所有请求 DTO 使用 Bean Validation。
- 更新和删除采用幂等、明确的业务规则。
- 对耗时 AI 操作设置超时，并为前端提供加载、失败和重试状态。
