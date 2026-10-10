<script setup>
import { FolderOpened, WarningFilled } from '@element-plus/icons-vue'

/**
 * 三态容器（《前端原型设计》§4.2、§8.2）：加载 / 空 / 错误。
 *
 * 正常态由默认插槽渲染。判定顺序为 加载 → 错误 → 空：
 * 请求失败时数据列表同样是空数组，错误必须优先于空态，否则会把「加载失败」
 * 误报成「暂无数据」。
 *
 * 空态的文案与主操作各页不同：优先渲染 #empty 插槽；未提供插槽时回退到
 * emptyTitle / emptyText / emptyActionText（点击发 action 事件）。
 */
defineProps({
  loading: { type: Boolean, default: false },
  /** 非空字符串即错误态（展示原因 + 重试按钮） */
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  emptyTitle: { type: String, default: '暂无数据' },
  emptyText: { type: String, default: '' },
  emptyActionText: { type: String, default: '' },
})

defineEmits(['retry', 'action'])
</script>

<template>
  <!-- 加载态：骨架屏（列表用 3–4 行骨架，§4.2） -->
  <div v-if="loading" class="state">
    <el-skeleton :rows="3" animated />
  </div>

  <!-- 错误态：原因 + 重试 -->
  <div v-else-if="error" class="state">
    <el-icon class="state__icon" :size="30"><WarningFilled /></el-icon>
    <h3 class="state__title">加载失败</h3>
    <p class="state__text">{{ error }}</p>
    <el-button @click="$emit('retry')">
      重试
    </el-button>
  </div>

  <!-- 空态 -->
  <div v-else-if="empty" class="state">
    <slot name="empty">
      <el-icon class="state__icon" :size="30"><FolderOpened /></el-icon>
      <h3 class="state__title">{{ emptyTitle }}</h3>
      <p v-if="emptyText" class="state__text">{{ emptyText }}</p>
      <el-button v-if="emptyActionText" type="primary" @click="$emit('action')">
        {{ emptyActionText }}
      </el-button>
    </slot>
  </div>

  <!-- 正常态 -->
  <slot v-else />
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 44px 20px;
  text-align: center;
}

.state__icon {
  color: var(--ink-400);
}

.state__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.state__text {
  max-width: 420px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-500);
}

/* 骨架屏需要撑满列表区域宽度 */
.state :deep(.el-skeleton) {
  width: 100%;
}
</style>
