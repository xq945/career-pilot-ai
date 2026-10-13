# 前端原型

智能求职辅助平台的 Web 高保真原型（毕业设计交付物之一）。

## 怎么打开

双击 [`index.html`](index.html) 即可（无需服务器、无需构建、无外部依赖）。
总览页列出全部 13 个页面，点击卡片进入；页面之间的按钮与链接已连通，可按真实路径走完整流程。

## 目录结构

```text
prototype/
├─ index.html              原型总览（入口页，不进入 Vue 实现）
├─ assets/
│  ├─ prototype.css        设计系统：色板、排版、间距、全部组件样式
│  ├─ prototype.js         侧边栏/顶栏注入、图标、弹窗与切换器等演示交互
│  └─ favicon.svg          站点图标（品牌机器人头像的简化版）
├─ login.html              登录 / 注册
├─ dashboard.html          仪表盘
├─ agent.html              求职智能体
├─ resumes.html            简历管理
├─ resume-analysis.html    简历 AI 分析
├─ jobs.html               岗位管理
├─ job-analysis.html       岗位 AI 分析
├─ optimization.html       简历定向优化
├─ optimization-report.html 优化工作台
├─ interview.html          AI 面试列表
├─ interview-session.html  模拟面试答题
├─ interview-report.html   面试报告
└─ profile.html            个人中心
```

## 两条阅读线索

**看设计**：从 `index.html` 进，逐页点开。每个页面源码顶部注明了路由、对应接口与关键业务规则。

**看实现依据**：读设计文档《前端原型设计》（本地 `docs/前端原型设计.md`，不随仓库分发）。其中第 1 章是页面 ↔ 路由 ↔ 接口的映射总表，第 5 章是逐页规格，第 10 章列出了现有接口无法完全支撑界面、需要与后端确认的事项。

## 关于页面内的「原型演示」控件

部分页面顶部有状态切换按钮（如「已分析 / 未分析 / 分析失败」）。这些**只是用来查看同一页面的不同状态**，Vue 实现时全部删除——状态由接口返回值驱动：

- `analyzed: false` → 空态
- `50200` / `50201` → 失败态并可重试
- 某题已有 `answer` → 已作答态

## 与最终实现的关系

- 原型用**内联 CSS 与原生 JS**，只为「打开即看」；实现用 Vue 3 + Element Plus，组件对照见设计文档 §2.4。
- 原型中的色值、圆角、阴影、字号可直接迁移为 CSS 变量或 Element Plus 主题变量。
- 界面图标为内联 SVG，实现时替换为 Element Plus Icons（Vue 侧已引入 `@element-plus/icons-vue`）；但**侧边栏 Logo 是品牌标记**，不属于通用图标，应保留自定义 SVG（原型中见 `assets/prototype.js` 的 `brandMark()`，Vue 实现在 `src/components/BrandMark.vue`）。
- 站点图标已随品牌资源一并生成到 `career-pilot-web/public/images/brand/`（`favicon.svg` / `.ico` / `apple-touch-icon.png`），并在 `career-pilot-web/index.html` 中引用；资源清单与生成方式见《品牌设计》（本地 `docs/品牌设计.md`）。
- 示例数据（简历名、岗位、分数）均为虚构，仅用于展示信息密度与布局。
