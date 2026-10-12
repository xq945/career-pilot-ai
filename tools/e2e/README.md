# 端到端验证工具

用**真实无头浏览器**驱动前端页面，验证那些只有在浏览器里才会暴露的行为：路由守卫、
刷新后的登录态恢复、`localStorage` 读写、组件实际渲染结果、401 的统一登出。

## 为什么是这套方案

本机**没有** Playwright、Puppeteer，也没有浏览器 MCP 工具。但：

- Node **v24** 内置了全局 `WebSocket`，因此零依赖就能讲 Chrome DevTools Protocol；
- 无头 Chrome 已是本项目的既有依赖 —— [`tools/brand/render.js`](../brand/render.js)
  就用它渲染 SVG。

于是不需要引入任何新的运行时或 npm 包。

## 工具清单

| 文件 | 用途 |
|---|---|
| `cdp.mjs` | 极简 CDP 客户端：启动浏览器、连接、`evaluate` / `goto` / `fill` / `click` / `waitFor` / 截图，以及断言汇总 |
| `auth-flow.mjs` | 认证闭环用例（注册、登录、守卫、刷新恢复、令牌失效、退出、404） |
| `profile-flow.mjs` | 个人中心用例（路由导航、昵称修改与即时同步、头像上传/替换/移除、双侧校验、页内退出） |
| `fixtures.mjs` | 简历测试文件的**动态构造器**（DOCX/PDF/HTML/TXT，含中文；全在内存按格式规范拼装，零二进制入库）。也可单独运行 `node tools/e2e/fixtures.mjs --out ./tmp` 生成一组文件供 curl 验收使用 |
| `resume-flow.mjs` | 简历管理用例（上传 DOCX/HTML/TXT/PDF、前端即时校验、服务端 415/400/413、删除三条后果与幂等、分页显隐与翻页） |
| `analysis-flow.mjs` | 简历 AI 分析用例（入口跳转与确认、AiWaiting 等待态、结果渲染、**复用路径秒回且版本不变**、未分析空态、错误态）；**消耗真实模型 token** |
| `resume-file-flow.mjs` | 简历原文件预览 / 下载用例（名称点击预览、下载图标、取回内容与上传原文一致、删除后 404） |
| `job-flow.mjs` | 岗位模块用例（新建/编辑弹窗与校验、**三态标签**、改描述后立即「分析已过期」、过期重分析生成新版本、复用路径、删除）；**消耗 2 次真实模型调用** |
| `match-flow.mjs` | 匹配模块用例（新建弹窗的就地拦截、报告页分数环/维度条/三栏明细与免责说明、重复匹配、过期拦截、删除后可见性）；**消耗真实模型调用** |
| `interview-flow.mjs` | 面试模块用例（创建弹窗校验与出题等待态、**进度分母取实际题数**、逐题作答与评价渲染、重答确认弹窗与**总分即时重算**、报告页总分/总评/分类/查看回答、列表进行中与已完成两态）；**消耗 6 次真实模型调用（出题 1 + 评价 3 + 总评 2）**，默认浏览器端口 9223（便于与 match/job 并行） |
| `agent-flow.mjs` | 求职智能体用例（侧栏入口点亮、空态与示例问题填入、上下文选择「未分析只提示不拦截」、非流式等待态文案、助手气泡与**工具调用折叠条只显示名称与状态**、会话列表新增/切换、刷新后恢复）；**消耗约 2–3 次真实对话调用（含工具内部的分析）**，默认浏览器端口 9224 |

## 用法

前后端都启动后（后端 8080、前端 5173）：

```bash
node tools/e2e/auth-flow.mjs
node tools/e2e/profile-flow.mjs
node tools/e2e/resume-flow.mjs
node tools/e2e/analysis-flow.mjs      # 消耗真实模型 token
node tools/e2e/resume-file-flow.mjs
node tools/e2e/job-flow.mjs           # 消耗 2 次真实模型调用
node tools/e2e/match-flow.mjs         # 消耗真实模型调用
node tools/e2e/interview-flow.mjs     # 消耗 6 次真实模型调用（端口 9223）
node tools/e2e/agent-flow.mjs         # 消耗约 2–3 次真实对话调用（端口 9224）

# 换地址
node tools/e2e/auth-flow.mjs --base http://localhost:5173 --api http://localhost:8080/api

# 同时输出各步骤截图到目录
node tools/e2e/auth-flow.mjs --shots ./shots
```

全部断言通过时退出码为 0，有失败项时为 1，可直接接进流水线。

测试文件均**动态构造、零二进制入库**：

- `profile-flow.mjs` 的头像在浏览器内用 canvas 生成真实 PNG；
- `resume-flow.mjs` 的简历经 `fixtures.mjs` 在内存中按格式规范拼装（DOCX 为手写
  ZIP 容器、PDF 为最小合法结构），base64 注入 `input[type=file]`；
- 测试数据由脚本结束时打印的清理 SQL 手工清除（后端无删除用户接口）。

## 边界

- **接口层验证不要用这里。** 请求响应结构、状态码、越权防护用 `curl` 更快也更精确，
  记录见《验证记录》（本地 `docs/验证记录.md`）。本工具只补浏览器独有的部分。
- `auth-flow.mjs` 会注册 `e2e_seed_*`、`e2e_new_*` 两个测试用户。后端没有删除用户的
  接口，脚本结束时打印清理用的 SQL，需手工执行。

## 写新用例时的坑

- **给 `v-model` 输入框赋值必须走原生 setter + `input` 事件**，直接改 `el.value`
  Vue 感知不到。`cdp.mjs` 的 `fill()` 已封装——它按**元素类型**取 value setter：
  `<input>` 与 `<textarea>` 的 value 在各自的原型上，用错原型会抛
  `TypeError: Illegal invocation`（填多行文本框须传 `.el-textarea__inner` 选择器）。
- **已登录时导航到 `/login`、`/register` 会被守卫重定向**，脚本若以为能停在那一页，
  后续会在一个空 DOM 上操作、报出难以理解的错误。开跑前先 `localStorage.clear()`。
- **Vue Router 不编码 query 中的 `/`**：实际是 `?redirect=/dashboard`，不是 `%2F`；
  断言 URL 前先 `decodeURIComponent`。
- **脚本赋值不会触发 blur 校验**：`fill()` 只设置 value 并派发事件、不获得焦点，
  依赖 `trigger: 'blur'` 的表单规则不会执行。要验证校验拦截，走真实用户路径
  （点提交按钮触发全量校验）而不是模拟 blur；`maxlength` 也只约束用户输入，
  拦不住脚本赋值（因此不能靠它来断言「输入被截断」）。
- **路由跳转的 URL 更新早于组件渲染**：`location.pathname` 匹配后，异步加载的
  页面组件可能还没挂载（首次访问还叠加 Vite 按需编译），此时 DOM 仍是上一页。
  跳转后要再等一个页面内元素出现，别直接断言内容。
- **el-dialog 用 v-show 控制显隐、DOM 常驻**：不能用 `querySelector` 是否存在判断
  「弹窗是否打开/关闭」，要用可见性（如 `offsetParent !== null`）。
- **页面内 fetch 与页面同源才有正确的 Origin**：跨域请求的 CORS 校验依赖 Origin，
  在 `about:blank` 上直接 evaluate fetch 会被拒；先 `goto` 到前端页面再发请求。
- **`--shots` 截图前要等进入动画结束**：Element Plus 的 `el-tag` 等组件带
  `el-zoom-in-center` 过渡（从缩小态放大），元素刚出现就截图会拍到被裁切/半透明的
  中间态。`job-flow.mjs` 的 `shot()` 已封装"等没有标签处于 `enter-active`"再截图。
- **`el-input-number` 的加减按钮连点不可靠**：同一 tick 内连续 `click()` 多次只生效一次
  （面试用例把题数从默认 5 调到 2 时踩到，三连点后值仍是 5）。改值优先用 `fill()` 写其内部
  输入框（`.el-input-number .el-input__inner`），读值校验不达标再逐次点击并留间隔。
- **列表行内的主操作按钮随状态变化**：写「点某按钮进详情」类断言前，先确认当前状态下该按钮
  真的存在（面试列表「进行中」的行是「继续答题」、「已完成」才是「查看报告」）。需要跳过
  状态时直接按 URL `goto` 到目标页更稳。
- **`ResourcePicker` 弹窗打开时资源列表仍在异步加载**：`.picker` 容器先渲染，列表项
  `.picker__item` 后到（加载期间是 `.picker__loading` 占位）。等容器出现就点列表项会找不到
  元素（agent-flow 首跑踩到），要按 **item 数量** 等待（`match-flow.mjs` / `agent-flow.mjs` 均如此）。
- 每个用例**失败不中断**：`createChecker()` 会跑完全部断言再汇总，一次拿到所有问题。
