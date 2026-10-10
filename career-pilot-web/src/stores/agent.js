import { ref } from 'vue'
import { defineStore } from 'pinia'

import { chatAgent, getAgentSession, listAgentSessions } from '@/api/agent'

/**
 * 求职智能体状态（《前端原型设计》§8.3：Pinia 只存跨页面共享的状态）。
 *
 * 当前会话与消息列表**刻意放在 store 而非组件内**：离开 /agent 再回来（或切换路由）
 * 时对话上下文不丢；登出时由 user store 联动清空，避免换账号后残留上一个人的对话。
 */
export const useAgentStore = defineStore('agent', () => {
  /* ---------------------------------------------------------------- 会话列表 */

  const sessions = ref([])
  const sessionsTotal = ref(0)
  const sessionsLoading = ref(false)
  const sessionsError = ref('')

  async function loadSessions(page = 1) {
    sessionsLoading.value = true
    sessionsError.value = ''
    try {
      const data = await listAgentSessions({ page, size: 20 })
      sessions.value = data.records
      sessionsTotal.value = data.total
      return data
    }
    catch (error) {
      sessionsError.value = error.message || '会话列表加载失败'
      return null
    }
    finally {
      sessionsLoading.value = false
    }
  }

  /* ---------------------------------------------------------------- 当前对话 */

  const activeSessionId = ref(null)
  const messages = ref([])
  const messagesLoading = ref(false)
  const sending = ref(false)
  /** 发送失败信息 { code, message }；null 表示无（内容留在输入框供重试） */
  const sendError = ref(null)

  /** 引用上下文（可选）：最多一份简历 + 一个岗位，随每次请求携带；名字仅用于界面展示 */
  const context = ref({ resumeId: null, resumeName: '', jobId: null, jobName: '' })

  /** 打开历史会话：消息以服务端为准整体替换（tool 行只有 toolName/status） */
  async function openSession(sessionId) {
    if (sending.value) {
      return
    }
    activeSessionId.value = sessionId
    messagesLoading.value = true
    sendError.value = null
    try {
      const data = await getAgentSession(sessionId)
      messages.value = (data.messages ?? []).map((message, index) => ({
        key: `h-${index}`,
        role: message.role,
        content: message.content,
        toolName: message.toolName,
        status: message.status,
        createdAt: message.createdAt,
      }))
    }
    catch (error) {
      sendError.value = { code: error.code, message: error.message || '会话加载失败' }
    }
    finally {
      messagesLoading.value = false
    }
  }

  /** 新建对话：清空当前会话（上下文选择保留，方便连续追问同一份资源） */
  function newSession() {
    activeSessionId.value = null
    messages.value = []
    sendError.value = null
  }

  /**
   * 发送一条消息（非流式）：先上图待气泡，响应后替换；失败时移除该轮气泡并抛出，
   * 由输入框恢复草稿——与后端"整轮成功才落库"的语义保持一致（失败不留半截会话）。
   */
  async function send(text) {
    const content = text.trim()
    if (!content || sending.value) {
      return null
    }
    sendError.value = null
    sending.value = true

    const stamp = Date.now()
    const userKey = `u-${stamp}`
    const pendingKey = `p-${stamp}`
    messages.value.push({ key: userKey, role: 'user', content, createdAt: new Date().toISOString() })
    messages.value.push({ key: pendingKey, role: 'assistant', pending: true, content: '' })

    try {
      const data = await chatAgent({
        sessionId: activeSessionId.value,
        message: content,
        resumeId: context.value.resumeId,
        jobId: context.value.jobId,
      })
      activeSessionId.value = data.sessionId
      replaceMessage(pendingKey, {
        key: pendingKey,
        role: 'assistant',
        content: data.message,
        toolCalls: data.toolCalls ?? [],
        truncated: data.truncated === true,
        createdAt: new Date().toISOString(),
      })
      // 会话列表的排序依据已被服务端刷新（G-8），本地重新拉一次保持侧栏一致
      await loadSessions()
      return data
    }
    catch (error) {
      // 该轮未落库：移除用户气泡与等待气泡，交由输入框恢复草稿
      messages.value = messages.value.filter((item) => item.key !== userKey && item.key !== pendingKey)
      sendError.value = { code: error.code, message: error.message || '发送失败，请稍后重试' }
      throw error
    }
    finally {
      sending.value = false
    }
  }

  function replaceMessage(key, replacement) {
    messages.value = messages.value.map((item) => (item.key === key ? replacement : item))
  }

  /** 登出时的清空（由 user store 的 reset 联动调用） */
  function reset() {
    sessions.value = []
    sessionsTotal.value = 0
    sessionsError.value = ''
    activeSessionId.value = null
    messages.value = []
    messagesLoading.value = false
    sending.value = false
    sendError.value = null
    context.value = { resumeId: null, resumeName: '', jobId: null, jobName: '' }
  }

  return {
    sessions,
    sessionsTotal,
    sessionsLoading,
    sessionsError,
    activeSessionId,
    messages,
    messagesLoading,
    sending,
    sendError,
    context,
    loadSessions,
    openSession,
    newSession,
    send,
    reset,
  }
})
