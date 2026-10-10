<script setup>
import { User, MagicStick } from '@element-plus/icons-vue'

import AgentToolTrace from '@/components/agent/AgentToolTrace.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 消息流（原型 §5.12）：用户气泡在右、助手气泡在左；非流式等待态为整块 spinner；
 * 历史回看时会出现 tool 行（只有工具名与状态，见《API接口设计》§8.3）。
 *
 * `truncated = true` 只是提示"回答可能不完整"（达到工具次数/时长上限时后端照常落库），
 * 不是错误态。
 */
defineProps({
  /** store 的 messages：{ key, role, content, pending?, toolCalls?, truncated?, toolName?, status? } */
  messages: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
</script>

<template>
  <StateBlock :loading="loading" :empty="false" :error="''">
    <div class="stream">
      <div v-for="message in messages" :key="message.key" class="msg" :class="`msg--${message.role}`">
        <!-- tool 行（历史回看）：只显示工具名与状态 -->
        <div v-if="message.role === 'tool'" class="msg__tool">
          <el-tag
            :type="message.status === 'SUCCESS' ? 'success' : 'danger'"
            size="small"
            effect="light"
          >
            {{ message.status === 'SUCCESS' ? '成功' : '失败' }}
          </el-tag>
          <span class="msg__tool-name">{{ message.toolName }}</span>
        </div>

        <template v-else>
          <div class="msg__avatar">
            <el-icon :size="16">
              <User v-if="message.role === 'user'" />
              <MagicStick v-else />
            </el-icon>
          </div>
          <div class="msg__body">
            <div class="msg__name">{{ message.role === 'user' ? '我' : '求职助手' }}</div>
            <div class="msg__bubble">
              <div v-if="message.pending" class="msg__pending">
                <span class="msg__spinner" />
                <span class="msg__pending-text">正在思考…（最长等待 120 秒）</span>
              </div>
              <template v-else>
                <p class="msg__text">{{ message.content }}</p>
                <p v-if="message.truncated" class="msg__truncated">
                  回答可能不完整：本次已达到工具调用或时长上限，可以再发一条消息继续。
                </p>
                <AgentToolTrace v-if="message.toolCalls?.length" :tool-calls="message.toolCalls" />
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>
  </StateBlock>
</template>

<style scoped>
.stream {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 12px;
}

.msg {
  display: flex;
  gap: 10px;
  max-width: 100%;
}

/* 用户消息靠右：avatar 顺序翻转 */
.msg--user {
  flex-direction: row-reverse;
}

.msg__avatar {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--brand-50);
  color: var(--brand-600);
}

.msg__body {
  min-width: 0;
  max-width: 78%;
}

.msg--user .msg__body {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.msg__name {
  font-size: 12px;
  color: var(--ink-400);
  margin-bottom: 4px;
}

.msg__bubble {
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 14px;
  line-height: 1.75;
  color: var(--ink-900);
}

.msg--user .msg__bubble {
  background: var(--brand-50);
  border-color: var(--brand-100, var(--line));
}

.msg__text {
  white-space: pre-wrap;
  word-break: break-word;
}

.msg__pending {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-500);
  font-size: 13px;
}

.msg__spinner {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border: 2px solid var(--brand-100, var(--line));
  border-top-color: var(--brand-600);
  border-radius: 50%;
  animation: msg-spin 0.8s linear infinite;
}

@keyframes msg-spin {
  to {
    transform: rotate(360deg);
  }
}

.msg__truncated {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-500);
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

/* ---- tool 行（历史回看） ---- */
.msg__tool {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 40px;
  padding: 4px 10px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--ink-500);
}

.msg__tool-name {
  font-weight: 500;
}
</style>
