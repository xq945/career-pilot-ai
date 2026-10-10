/**
 * 认证信息的本地存储读写的唯一入口。
 *
 * 单独成模块的原因：`api/request.js`（请求前注入 Token）与 `stores/user.js`（状态管理）
 * 都要读写同一份 localStorage 数据。若两边各写一套，一旦 key 或格式调整就会出现
 * "拦截器读到了、store 没读到"这类难查的问题；若让 request.js 直接依赖 store，
 * 又会形成 store → api → request → store 的循环依赖。
 *
 * 存储位置依据《系统架构设计》7.3 与《API接口设计》2 节：localStorage + Authorization 头。
 * 安全权衡：localStorage 可被同源脚本读取，理论上存在 XSS 窃取风险；但本项目
 * 认证依赖 Authorization 头而非 Cookie，后端不发送凭据 Cookie、CSRF 防护已关闭，
 * 改为 httpOnly Cookie 需要一并改动后端认证机制，超出前端范围。在此前提下，
 * 控制风险的手段是不把不可信内容渲染为 HTML（见《前端原型设计》§7 的文案约定）。
 */

/** Token 在 localStorage 中的键名（《前端原型设计》§5.1） */
const TOKEN_KEY = 'token'

/** 用户资料在 localStorage 中的键名（《前端原型设计》§5.1） */
const USER_KEY = 'user'

export function readToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function readUser() {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  }
  catch {
    // 存储内容被外部改坏时不应让整个应用崩溃，按未登录处理即可
    localStorage.removeItem(USER_KEY)
    return null
  }
}

/** 登录成功后写入 Token 与用户资料 */
export function writeAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/** 仅更新用户资料，保持 Token 不变（刷新资料、退出登录前的资料变更场景） */
export function writeUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/** 清除全部认证信息。退出登录与收到 401 时调用 */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
