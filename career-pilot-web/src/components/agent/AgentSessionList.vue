<script setup>
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

/**
 * 会话列表（原型 §5.12 左侧栏、《API接口设计》§8.2）：
 * 「新建对话」+ 按最近活跃排序的会话项（标题 + 时间 · 消息数）。
 */
defineProps({
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['create', 'open', 'retry'])

/** 时间显示：今天 / 昨天 / 更早（原型样式） */
function formatTime(iso) {
  if (!iso) {
    return ''
  }
  const time = dayjs(iso)
  const now = dayjs()
  if (time.isSame(now, 'day')) {
    return `今天 ${time.format('HH:mm')}`
  }
  if (time.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${time.format('HH:mm')}`
  }
  return time.format('MM-DD HH:mm')
}
</script>

<template>
  <div class="side">
    <div class="side__head">
      <el-button type="primary" class="side__new" :icon="Plus" @click="emit('create')">
        新建对话
      </el-button>
    </div>

    <div class="side__list">
      <p v-if="loading" class="side__hint">加载中…</p>
      <template v-else-if="error">
        <p class="side__hint side__hint--error">{{ error }}</p>
        <el-button link type="primary" size="small" @click="emit('retry')">
          重试
        </el-button>
      </template>
      <p v-else-if="sessions.length === 0" class="side__hint">
        还没有对话记录
      </p>

      <button
        v-for="session in sessions"
        :key="session.sessionId"
        type="button"
        class="session"
        :class="{ 'session--active': session.sessionId === activeSessionId }"
        @click="emit('open', session.sessionId)"
      >
        <span class="session__title">{{ session.title }}</span>
        <span class="session__meta">
          {{ formatTime(session.updatedAt) }} · {{ session.messageCount }} 条消息
        </span>
      </button>
    </div>

    <div class="side__foot">会话按最近活跃时间排序</div>
  </div>
</template>

<style scoped>
.side {
  width: 252px;
  flex: 0 0 252px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--surface);
  min-height: 0;
}

.side__head {
  padding: 14px;
  border-bottom: 1px solid var(--line);
}

.side__new {
  width: 100%;
}

.side__list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.side__hint {
  padding: 12px;
  font-size: 12px;
  color: var(--ink-400);
}

.side__hint--error {
  color: var(--danger);
}

.session {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.session:hover {
  background: var(--bg);
}

.session--active {
  background: var(--brand-50);
}

.session__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session__meta {
  font-size: 11px;
  color: var(--ink-400);
}

.side__foot {
  flex: 0 0 auto;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--ink-400);
}
</style>
