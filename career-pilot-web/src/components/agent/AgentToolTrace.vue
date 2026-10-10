<script setup>
import { ref } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'

/**
 * 工具调用摘要折叠条（原型 §5.12、《API接口设计》§8.1）。
 *
 * 只显示工具名与执行状态——工具的原始入参与结果可能包含大段简历文本，
 * 后端刻意不返回（§8.3 同一口径），前端也不要臆造细节。
 */
defineProps({
  /** [{ toolName, status }] */
  toolCalls: { type: Array, default: () => [] },
})

const expanded = ref(false)
</script>

<template>
  <div v-if="toolCalls.length > 0" class="trace">
    <button class="trace__head" type="button" @click="expanded = !expanded">
      <el-icon class="trace__arrow" :class="{ 'trace__arrow--open': expanded }">
        <ArrowRight />
      </el-icon>
      本次调用了 {{ toolCalls.length }} 个工具{{ expanded ? '' : '（点击展开）' }}
    </button>

    <div v-show="expanded" class="trace__list">
      <div v-for="(call, index) in toolCalls" :key="`${call.toolName}-${index}`" class="trace__item">
        <el-tag
          :type="call.status === 'SUCCESS' ? 'success' : 'danger'"
          size="small"
          effect="light"
        >
          {{ call.status === 'SUCCESS' ? '成功' : '失败' }}
        </el-tag>
        <span class="trace__name">{{ call.toolName }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace {
  margin-top: 10px;
  border-top: 1px dashed var(--line);
  padding-top: 8px;
}

.trace__head {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink-500);
  cursor: pointer;
}

.trace__head:hover {
  color: var(--brand-600);
}

.trace__arrow {
  font-size: 11px;
  transition: transform 0.15s;
}

.trace__arrow--open {
  transform: rotate(90deg);
}

.trace__list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace__item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-700);
}

.trace__name {
  font-weight: 500;
}
</style>
