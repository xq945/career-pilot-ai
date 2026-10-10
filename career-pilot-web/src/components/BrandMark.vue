<script setup>
import { useId } from 'vue'

/**
 * 品牌标记：机器人助手的简化头像，取自原型 prototype/assets/prototype.js 的 brandMark()。
 *
 * 为什么不换成 Element Plus Icons：它不是通用图标，而是品牌资产
 * （与 public/images/brand/ 下的 favicon 同一视觉），原型 README 明确要求保留自定义 SVG。
 *
 * 渐变 id 用 useId() 生成唯一值：同一页面渲染多个实例时 id 不能重复，
 * 否则第二个实例的 fill 会引用到第一个实例的渐变。
 */
defineProps({
  size: {
    type: Number,
    default: 26,
  },
})

const gradientId = `brand-mark-${useId()}`
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0" stop-color="#8FCBF7" />
        <stop offset="1" stop-color="#78BDF5" />
      </linearGradient>
    </defs>
    <rect x="2" y="3" width="60" height="58" rx="19" :fill="`url(#${gradientId})`" />
    <ellipse cx="32" cy="33" rx="24" ry="18" fill="#FFF9F0" />
    <circle cx="22" cy="30" r="6.2" fill="#34415E" />
    <circle cx="42" cy="30" r="6.2" fill="#34415E" />
    <path
      d="M25.5 40Q32 46 38.5 40"
      fill="none"
      stroke="#34415E"
      stroke-width="4.2"
      stroke-linecap="round"
    />
  </svg>
</template>
