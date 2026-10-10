<script setup>
/**
 * 维度得分条（《前端原型设计》§5.8）：五条横向进度条 + 权重标注。
 *
 * **权重与顺序全部取自接口**（`dimensionScores.items`，服务端保证按权重降序）——
 * 本组件不得硬编码权重数值与维度顺序，否则评分规则版本调整后展示即失真。
 */
defineProps({
  /** 接口 dimensionScores.items：{ key, label, weight, score }[] */
  items: { type: Array, default: () => [] },
})

/** 得分语义色与分数标签一致（≥80 绿、60–79 蓝、<60 橙，§5.7） */
function fillClass(score) {
  if (score >= 80) {
    return 'dim__fill--ok'
  }
  if (score >= 60) {
    return 'dim__fill--brand'
  }
  return 'dim__fill--warn'
}
</script>

<template>
  <div class="dim-list">
    <div v-for="item in items" :key="item.key" class="dim">
      <div class="dim__label">
        {{ item.label }}<small>权重 {{ item.weight }}%</small>
      </div>
      <div class="dim__track">
        <div
          class="dim__fill"
          :class="fillClass(item.score)"
          :style="{ width: `${item.score}%` }"
        />
      </div>
      <div class="dim__value">
        {{ item.score }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.dim-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dim {
  display: grid;
  grid-template-columns: 132px 1fr 40px;
  align-items: center;
  gap: 12px;
}

.dim__label {
  font-size: 13px;
  color: var(--ink-700);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.dim__label small {
  font-size: 12px;
  color: var(--ink-400);
}

.dim__track {
  height: 8px;
  border-radius: 4px;
  background: var(--bg);
  overflow: hidden;
}

.dim__fill {
  height: 100%;
  border-radius: 4px;
  background: var(--brand-600);
  transition: width 0.6s ease;
}

.dim__fill--ok {
  background: var(--ok);
}

.dim__fill--brand {
  background: var(--brand-600);
}

.dim__fill--warn {
  background: var(--warn);
}

.dim__value {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-900);
  text-align: right;
}
</style>
