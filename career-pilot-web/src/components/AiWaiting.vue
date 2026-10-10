<script setup>
/**
 * AI 等待态（《前端原型设计》§4.3、§8.2）。
 *
 * 分析、匹配、出题、评价、对话五处通用：spinner + 预计耗时说明 + 骨架屏 + 可离开提示。
 * 「可以离开本页」有依据：请求由服务端同步处理、结果落库，回到本页重新查询即可看到。
 *
 * 组件只负责呈现，发起与超时控制由调用方（页面）负责。
 */
defineProps({
  /** 主文案 */
  title: { type: String, default: 'AI 正在阅读你的简历…' },
  /** 预计耗时说明 */
  hint: {
    type: String,
    default: '通常需要 10–30 秒。分析内容包括技能梳理、经历提取、优势与改进建议。',
  },
  /** 可离开提示；传空字符串则不显示 */
  leaveHint: { type: String, default: '分析在服务器端进行，可以离开本页，稍后回来查看结果。' },
  /** 骨架屏行数；0 表示不显示 */
  skeletonRows: { type: Number, default: 3 },
})
</script>

<template>
  <div class="ai-waiting">
    <div class="ai-waiting__head">
      <span class="ai-waiting__spinner" />
      <span class="ai-waiting__title">{{ title }}</span>
    </div>

    <p v-if="hint" class="ai-waiting__hint">
      {{ hint }}
    </p>

    <div v-if="skeletonRows > 0" class="ai-waiting__skeleton">
      <el-skeleton :rows="skeletonRows" animated />
    </div>

    <p v-if="leaveHint" class="ai-waiting__leave">
      {{ leaveHint }}
    </p>
  </div>
</template>

<style scoped>
.ai-waiting {
  padding: 32px 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-subtle, var(--bg));
}

.ai-waiting__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 圆环 spinner（原型 .spinner） */
.ai-waiting__spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--brand-600);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ai-spin 0.8s linear infinite;
}

@keyframes ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-waiting__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.ai-waiting__hint {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-500);
}

.ai-waiting__skeleton {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

.ai-waiting__leave {
  margin-top: 14px;
  font-size: 12px;
  color: var(--ink-400);
}
</style>
