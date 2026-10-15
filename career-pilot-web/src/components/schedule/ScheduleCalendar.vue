<script setup>
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'

/**
 * 面试日程 · 日历视图（M17，《前端原型设计》§5.15）。
 *
 * 数据由父组件**按月拉取**（本组件不发起请求）；月份切换通过 v-model 选中日期的变化检测
 * （el-calendar 无独立月份事件）向上 emit `month-change`。当日日程渲染为「公司 · 时间」小条，
 * 超 3 条显示「+N」；点击小条 emit `select`（父组件打开编辑弹窗）。
 */
const props = defineProps({
  /** 当月日程（父组件按 from/to 拉取的结果） */
  schedules: { type: Array, default: () => [] },
})

const emit = defineEmits(['month-change', 'select'])

const currentDate = ref(new Date())

/** 当前展示的月份（用于去重 month-change） */
const shownMonth = ref(dayjs().format('YYYY-MM'))

/** 按日分组：'YYYY-MM-DD' → 当日日程 */
const byDay = computed(() => {
  const map = {}
  for (const item of props.schedules) {
    const key = dayjs(item.interviewTime).format('YYYY-MM-DD')
    if (!map[key]) {
      map[key] = []
    }
    map[key].push(item)
  }
  return map
})

const itemsOf = (day) => byDay.value[day] ?? []

watch(currentDate, (value) => {
  const month = dayjs(value).format('YYYY-MM')
  if (month !== shownMonth.value) {
    shownMonth.value = month
    emit('month-change', month)
  }
})

/** 状态色点（与列表状态标签语义一致） */
const STATUS_DOT = {
  PENDING: 'var(--brand-600)',
  COMPLETED: 'var(--el-color-success)',
  CANCELLED: 'var(--ink-400)',
  EXPIRED: 'var(--el-color-warning)',
}
</script>

<template>
  <el-card shadow="never" class="calendar-card">
    <el-calendar v-model="currentDate">
      <template #date-cell="{ data }">
        <div class="cell">
          <div class="cell__day">
            {{ data.day.split('-')[2] }}
          </div>
          <div
            v-for="item in itemsOf(data.day).slice(0, 3)"
            :key="item.id"
            class="cell__chip"
            @click.stop="emit('select', item)"
          >
            <span class="cell__dot" :style="{ background: STATUS_DOT[item.status] ?? 'var(--ink-400)' }" />
            {{ item.companyName }} · {{ dayjs(item.interviewTime).format('HH:mm') }}
          </div>
          <div v-if="itemsOf(data.day).length > 3" class="cell__more">
            +{{ itemsOf(data.day).length - 3 }} 条
          </div>
        </div>
      </template>
    </el-calendar>
  </el-card>
</template>

<style scoped>
.calendar-card {
  border-radius: var(--radius);
}

.calendar-card :deep(.el-calendar-table .el-calendar-day) {
  height: 96px;
  padding: 4px;
}

.cell {
  height: 100%;
  overflow: hidden;
}

.cell__day {
  font-size: 12px;
  color: var(--ink-500);
  margin-bottom: 2px;
}

.cell__chip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 1.5;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--ink-700);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell__chip:hover {
  background: var(--brand-50);
  color: var(--brand-600);
}

.cell__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 6px;
}

.cell__more {
  font-size: 11px;
  color: var(--ink-400);
}
</style>
