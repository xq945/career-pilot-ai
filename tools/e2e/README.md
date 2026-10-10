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

## 用法

前后端都启动后（后端 8080、前端 5173）：

```bash
node tools/e2e/auth-flow.mjs
node tools/e2e/profile-flow.mjs
node tools/e2e/resume-flow.mjs

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
  Vue 感知不到。`cdp.mjs` 的 `fill()` 已封装。
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
- 每个用例**失败不中断**：`createChecker()` 会跑完全部断言再汇总，一次拿到所有问题。
