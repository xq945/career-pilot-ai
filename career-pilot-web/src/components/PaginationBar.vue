<script setup>
import { computed } from 'vue'

/**
 * 列表分页条（《前端原型设计》§4.4）：左侧「共 N 条」，右侧翻页按钮。
 *
 * 数据量少于一个分页时**保留分页条位置**、隐藏页码按钮（容器高度不变，避免布局跳动）。
 * 翻页后由调用方重新拉取数据；`page` 用 v-model:page 双向绑定。
 */
const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  size: { type: Number, default: 10 },
})

const emit = defineEmits(['update:page'])

const pageCount = computed(() => Math.ceil(props.total / props.size))

function handleChange(next) {
  emit('update:page', next)
}
</script>

<template>
  <div class="pagination-bar">
    <span class="pagination-bar__info">共 {{ total }} 条</span>
    <el-pagination
      v-if="pageCount > 1"
      :current-page="page"
      :page-size="size"
      :total="total"
      layout="prev, pager, next"
      background
      @current-change="handleChange"
    />
  </div>
</template>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 固定高度：页码按钮隐藏时位置仍保留（§4.4） */
  min-height: 32px;
}

.pagination-bar__info {
  font-size: 13px;
  color: var(--ink-500);
}
</style>
