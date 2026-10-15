<script setup>
import { useRouter } from 'vue-router'

import StateBlock from '@/components/StateBlock.vue'

/**
 * 工作台「最近记录」卡（《前端原型设计》§5.2）：标题 + 副标题 + 三态（加载 / 错误 / 空）
 * + 行插槽 +「查看全部」入口。
 *
 * 四个最近记录区块共用本外壳；行内容由使用方通过默认插槽提供——**行样式须写在
 * 使用方**（scoped 样式不作用于插槽内容，插槽内容属于父组件作用域）。
 */
defineProps({
  title: { type: String, required: true },
  /** 副标题（如「按上传时间 · 共 3 份」） */
  sub: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  emptyTitle: { type: String, default: '暂无记录' },
  emptyText: { type: String, default: '' },
  emptyActionText: { type: String, default: '' },
  /** 「查看全部」目标（vue-router location 对象）；为空则不渲染该入口 */
  moreTo: { type: Object, default: null },
})

defineEmits(['retry', 'action'])

const router = useRouter()
</script>

<template>
  <el-card shadow="never" class="recent">
    <template #header>
      <div class="card__head">
        <h2>{{ title }}</h2>
        <span v-if="sub" class="card__sub">{{ sub }}</span>
      </div>
    </template>

    <StateBlock
      :loading="loading"
      :error="error"
      :empty="empty"
      :empty-title="emptyTitle"
      :empty-text="emptyText"
      :empty-action-text="emptyActionText"
      @retry="$emit('retry')"
      @action="$emit('action')"
    >
      <div class="recent__list">
        <slot />
      </div>
    </StateBlock>

    <div v-if="moreTo && !loading && !error && !empty" class="recent__foot">
      <el-button link type="primary" @click="router.push(moreTo)">
        查看全部
      </el-button>
    </div>
  </el-card>
</template>

<style scoped>
.recent {
  border-radius: var(--radius);
}

.recent :deep(.el-card__header) {
  padding: 14px 18px;
}

.recent :deep(.el-card__body) {
  padding: 14px 18px;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card__head h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.card__sub {
  font-size: 12px;
  color: var(--ink-400);
}

.recent__list {
  display: flex;
  flex-direction: column;
}

/* 空态与骨架屏在卡片内更紧凑（行数少，不需要 StateBlock 默认的 44px 内边距） */
.recent :deep(.state) {
  padding: 22px 12px;
}

.recent__foot {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  text-align: center;
}
</style>
