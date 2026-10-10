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

## 用法

前后端都启动后（后端 8080、前端 5173）：

```bash
node tools/e2e/auth-flow.mjs
node tools/e2e/profile-flow.mjs

# 换地址
node tools/e2e/auth-flow.mjs --base http://localhost:5173 --api http://localhost:8080/api

# 同时输出各步骤截图到目录
node tools/e2e/auth-flow.mjs --shots ./shots
```

全部断言通过时退出码为 0，有失败项时为 1，可直接接进流水线。

`profile-flow.mjs` 的头像上传用「浏览器内 canvas 生成真实 PNG → `DataTransfer` 注入
`input[type=file]`」的方式，无需携带二进制测试文件；测试头像由「移除头像」接口在用例内清理。

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
- 每个用例**失败不中断**：`createChecker()` 会跑完全部断言再汇总，一次拿到所有问题。
