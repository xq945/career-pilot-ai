# 智能求职辅助平台

基于 Spring AI 的智能体应用开发（本科毕业设计）。

面向个人求职者，提供简历管理、岗位管理、简历与岗位匹配、AI 面试和求职智能体等功能。

## 技术栈

| 层次 | 选型 | 版本 |
|---|---|---|
| 前端 | Vue 3 + Vite + Vue Router + Pinia | 官方稳定版 |
| UI | Element Plus | 官方稳定版 |
| HTTP | Axios | 官方稳定版 |
| 后端 | Java + Spring Boot | Java 21 + Spring Boot 4.1.1 |
| AI 集成 | Spring AI | 2.0.1 |
| 模型 | DeepSeek API | `deepseek-flash` |
| 数据库 | MySQL | 8.0+（推荐 8.4 LTS） |
| ORM | MyBatis-Plus | 3.5.17 |
| 认证 | Spring Security + jjwt | 7.x + 0.12.7 |
| 文件解析 | Apache Tika | 3.3.2 |

## 目录结构

```text
career-pilot-ai/
├─ career-pilot-server/   后端（Spring Boot 4.1.1 + Java 21）
├─ career-pilot-web/      前端（Vue 3 + Vite）
├─ Mysql/                 数据库初始化脚本
└─ docs/                  设计与接口文档
```

## 快速开始

### 前置条件

| 组件 | 要求 | 本项目验证环境 |
|---|---|---|
| JDK | 21 | 21.0.12 |
| Maven | 3.9+ | 3.9.16 |
| Node.js | 20+ | 24.21.0 |
| MySQL | 8.0+ | 8.0.46 |

### 1. 初始化数据库

```bash
mysql -u root -p < Mysql/career_pilot_init.sql
```

脚本创建 `career_pilot` 库（utf8mb4 / utf8mb4_0900_ai_ci）与 10 张表，内容由《数据库设计》的 DDL 生成，与设计文档保持同步。

### 2. 配置后端

复制配置模板并填入真实值：

```bash
cd career-pilot-server/src/main/resources
cp application-local.yml.example application-local.yml
```

需填写三项：

| 配置项 | 说明 |
|---|---|
| `spring.datasource.password` | MySQL 密码 |
| `spring.ai.deepseek.api-key` | DeepSeek API Key —— **缺失会导致应用启动失败**，非仅调用时失败 |
| `app.jwt.secret` | JWT 签名密钥，用 `openssl rand -base64 48` 生成 |

`application-local.yml` 已被 `.gitignore` 忽略，不会进入版本库。

### 3. 启动后端

```bash
cd career-pilot-server
mvn clean package
java -jar target/career-pilot-server-0.0.1-SNAPSHOT.jar
```

服务地址 `http://localhost:8080`。

> **务必用 JDK 21 运行。** 若本机 `JAVA_HOME` 指向其他版本，注意 `java -jar` 走的是 PATH 解析而非 `JAVA_HOME`，此时应使用完整路径：`/path/to/jdk21/bin/java -jar target/career-pilot-server-0.0.1-SNAPSHOT.jar`。否则会报 `UnsupportedClassVersionError`。

验证是否正常：

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test01","email":"test01@example.com","password":"Test1234"}'
```

返回 `{"code":0,...}` 即表示服务与数据库均正常。

### 4. 启动前端

```bash
cd career-pilot-web
npm install
npm run dev
```

访问 `http://localhost:5173`。

## 配置说明

### 敏感配置与注入方式

以下配置**不进入仓库**，通过 `application-local.yml`（推荐）或环境变量注入：

| 配置项 | 对应环境变量 | 用途 |
|---|---|---|
| `spring.datasource.password` | `DB_PASSWORD` | MySQL 连接密码 |
| `spring.ai.deepseek.api-key` | `DEEPSEEK_API_KEY` | 大模型调用凭据 |
| `app.jwt.secret` | — | JWT 签名密钥（HS256，不少于 32 字节） |

`application.yml` 中只保留非敏感默认值。

### 可调参数

| 项 | 默认值 | 配置项 |
|---|---|---|
| 后端端口 | 8080 | `server.port` |
| 前端开发端口 | 5173 | `career-pilot-web/vite.config.js` |
| 允许的跨域来源 | `http://localhost:5173` | `app.cors.allowed-origins` |
| JWT 有效期 | 7200 秒 | `app.jwt.expiration-seconds` |
| 模型名 | `deepseek-flash` | `spring.ai.deepseek.chat.options.model` |

## 文档

| 文档 | 说明 |
|---|---|
| [系统架构设计](docs/系统架构设计.md) | 技术选型、分层职责、安全与部署约定 |
| [数据库设计](docs/数据库设计.md) | 表结构、字段与删除策略 |
| [API接口设计](docs/API接口设计.md) | REST 接口与统一响应结构 |
| [Agent设计](docs/Agent设计.md) | 智能体、工具调用与 Prompt 约定 |
| [设计审查报告](docs/设计审查报告.md) | 待验证项与设计问题清单 |
| [验证记录](docs/验证记录.md) | 各功能实现后的实测过程与结果 |
| [问题记录](docs/问题记录/) | 实施中实际遇到的问题，按类别归档 |
