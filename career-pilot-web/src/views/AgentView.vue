<script setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import { MagicStick } from '@element-plus/icons-vue'

import AgentComposer from '@/components/agent/AgentComposer.vue'
import AgentMessageList from '@/components/agent/AgentMessageList.vue'
import AgentSessionList from '@/components/agent/AgentSessionList.vue'
import { useAgentStore } from '@/stores/agent'

/**
 * 求职智能体（原型 §5.12、《API接口设计》§8）。
 *
 * 交互要点：
 * - 第一版**非流式**：发送后整体等待（等待态文案"最长等待 120 秒"）；
 * - 上下文资源可选：不选也能提问，助手需要具体资源时会反过来询问；
 * - `truncated = true` 只提示"回答可能不完整"（达到工具次数/时长上限时该轮照常落库）；
 * - 发送失败（502 等）该轮**不落库**：错误气泡提示并把草稿放回输入框。
 *
 * 会话与消息列表放在 store（`stores/agent.js`），离开页面再回来对话不丢。
 */
const agentStore = useAgentStore()

const composerRef = ref(null)
const scrollRef = ref(null)

const messages = computed(() => agentStore.messages)
const context = computed({
  get: () => agentStore.context,
  set: (value) => {
    agentStore.context = value
  },
})

const EXAMPLES = [
  '帮我分析一下我的简历，看看适合投什么方向',
  '我的简历和 Java 后端岗位差在哪，怎么补',
  '针对这个岗位帮我准备几个面试问题',
]

onMounted(() => {
  agentStore.loadSessions()
})

/** 新消息到达后滚动到底部（等待气泡出现时同样触发） */
watch(
  () => [messages.value.length, agentStore.sending],
  async () => {
    await nextTick()
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    }
  },
)

async function handleSend(text) {
  try {
    await agentStore.send(text)
  }
  catch {
    // 该轮未落库：把内容放回输入框，错误气泡由 AgentMessageList 上方的提示呈现
    composerRef.value?.restore(text)
  }
}

function openSession(sessionId) {
  if (sessionId !== agentStore.activeSessionId) {
    agentStore.openSession(sessionId)
  }
}

function useExample(example) {
  composerRef.value?.setDraft(example)
}
</script>

<template>
  <div class="agent">
    <AgentSessionList
      :sessions="agentStore.sessions"
      :active-session-id="agentStore.activeSessionId"
      :loading="agentStore.sessionsLoading"
      :error="agentStore.sessionsError"
      @create="agentStore.newSession()"
      @open="openSession"
      @retry="agentStore.loadSessions()"
    />

    <div class="agent__main">
      <div ref="scrollRef" class="agent__stream">
        <!-- 空态引导（原型 §5.12）：三个示例问题 -->
        <div v-if="messages.length === 0 && !agentStore.messagesLoading" class="empty">
          <div class="empty__icon">
            <el-icon :size="30"><MagicStick /></el-icon>
          </div>
          <h2 class="empty__title">我是你的求职助手</h2>
          <p class="empty__text">
            我可以读你的简历与目标岗位，帮你分析匹配情况、找出差距、准备面试。
            所有结论都基于系统里的真实数据，不会凭空推测。
          </p>
          <div class="empty__examples">
            <el-button
              v-for="example in EXAMPLES"
              :key="example"
              class="empty__example"
              @click="useExample(example)"
            >
              {{ example }}
            </el-button>
          </div>
        </div>

        <template v-else>
          <el-alert
            v-if="agentStore.sendError"
            class="agent__error"
            type="error"
            :closable="false"
            show-icon
            :title="agentStore.sendError.message"
          >
            <p v-if="agentStore.sendError.code === 50200 || agentStore.sendError.code === 50201"
                class="agent__error-text">
              本次提问没有产生任何记录，修改后可以直接重试。
            </p>
          </el-alert>

          <AgentMessageList :messages="messages" :loading="agentStore.messagesLoading" />
        </template>
      </div>

      <AgentComposer
        ref="composerRef"
        v-model:context="context"
        :sending="agentStore.sending"
        @send="handleSend"
      />
    </div>
  </div>
</template>

<style scoped>
.agent {
  display: flex;
  height: calc(100vh - 120px);
  min-height: 520px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.agent__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.agent__stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px 0;
}

.agent__error {
  margin-bottom: 14px;
}

.agent__error-text {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

/* ---- 空态 ---- */
.empty {
  max-width: 560px;
  margin: 6vh auto 0;
  text-align: center;
}

.empty__icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  background: var(--brand-50);
  color: var(--brand-600);
}

.empty__title {
  font-size: 19px;
  margin-bottom: 8px;
}

.empty__text {
  margin-bottom: 20px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink-500);
}

.empty__examples {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty__example {
  height: auto;
  min-height: 42px;
  padding: 10px 14px;
  justify-content: flex-start;
  white-space: normal;
  text-align: left;
}
</style>
