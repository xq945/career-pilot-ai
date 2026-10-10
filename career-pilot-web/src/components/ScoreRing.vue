<script setup>
import { computed } from 'vue'

/**
 * 综合匹配度环形进度（《前端原型设计》§5.8）：SVG 双圆 + stroke-dasharray。
 *
 * 分数语义色与列表的分数标签一致（§5.7）：≥80 绿、60–79 蓝、<60 橙。
 * 分数由后端确定性计算，本组件**只负责呈现**、不做任何加工或重新解释
 * （不得表述为录用概率，见 §5.8 的措辞要求）。
 */
const props = defineProps({
  /** 匹配总分（0–100，后端返回的两位小数） */
  score: { type: Number, required: true },
  /** 容器边长（px） */
  size: { type: Number, default: 132 },
  /** 环下方的说明文字 */
  caption: { type: String, default: '综合匹配度' },
})

/** 环与容器边缘的留白（含描边宽度） */
const RADIUS_GAP = 10

const STROKE_WIDTH = 12

const center = computed(() => props.size / 2)

const radius = computed(() => props.size / 2 - RADIUS_GAP)

const circumference = computed(() => 2 * Math.PI * radius.value)

/** 进度：分数越小缺口越大（-90° 起点由 rotate 实现） */
const dashOffset = computed(() => {
  const bounded = Math.min(Math.max(props.score, 0), 100)
  return circumference.value * (1 - bounded / 100)
})

const color = computed(() => {
  if (props.score >= 80) {
    return 'var(--ok)'
  }
  if (props.score >= 60) {
    return 'var(--brand-600)'
  }
  return 'var(--warn)'
})

/** 展示值去掉尾零（76.50 → 76.5、76.00 → 76），数值本身不变 */
const displayScore = computed(() => Number(props.score))
</script>

<template>
  <div class="score-ring">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        stroke="var(--line)"
        :stroke-width="STROKE_WIDTH"
      />
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke="color"
        :stroke-width="STROKE_WIDTH"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        class="score-ring__value"
      />
    </svg>
    <div class="score-ring__text">
      <div class="score-ring__num">{{ displayScore }}<small>分</small></div>
      <div class="score-ring__cap">{{ caption }}</div>
    </div>
  </div>
</template>

<style scoped>
.score-ring {
  position: relative;
  display: inline-block;
  line-height: 0;
}

.score-ring__value {
  /* 从 12 点方向开始绘制 */
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dashoffset 0.6s ease;
}

.score-ring__text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
}

.score-ring__num {
  font-size: 30px;
  font-weight: 700;
  color: var(--ink-900);
}

.score-ring__num small {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-400);
  margin-left: 2px;
}

.score-ring__cap {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-500);
}
</style>
