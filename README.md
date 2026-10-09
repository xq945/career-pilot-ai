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
| 文件解析 | Apache Tika | 官方稳定版 |

## 目录结构

```text
career-pilot-ai/
├─ career-pilot-server/   后端（Spring Boot）
├─ career-pilot-web/      前端（Vue 3 + Vite）
└─ docs/                  设计与接口文档
```

## 文档

| 文档 | 说明 |
|---|---|
| [系统架构设计](docs/系统架构设计.md) | 技术选型、分层职责、安全与部署约定 |
| [数据库设计](docs/数据库设计.md) | 表结构、字段与删除策略 |
| [API接口设计](docs/API接口设计.md) | REST 接口与统一响应结构 |
| [Agent设计](docs/Agent设计.md) | 智能体、工具调用与 Prompt 约定 |
| [设计审查报告](docs/设计审查报告.md) | 待验证项与设计问题清单 |

## 开发环境

- 前端：Vite 开发服务器 `http://localhost:5173`
- 后端：Spring Boot `http://localhost:8080`
- 数据库：本机 MySQL 8.x

> 密钥类配置（数据库密码、JWT 密钥、DeepSeek API Key）通过环境变量或 `application-local.yml` 注入，不写入仓库。
