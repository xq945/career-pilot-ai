<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

import { deleteSchedule, listSchedules, updateScheduleStatus } from '@/api/schedule'
import PaginationBar from '@/components/PaginationBar.vue'
import ScheduleCalendar from '@/components/schedule/ScheduleCalendar.vue'
import ScheduleFormDialog from '@/components/schedule/ScheduleFormDialog.vue'
import StateBlock from '@/components/StateBlock.vue'

/**
 * 面试日程（《前端原型设计》§5.15，接口《API接口设计》§9A）。
 *
 * 列表 / 日历双视图：列表分页 + 状态筛选；日历**按月拉取**（不拉全量）。
 * 状态机：仅 PENDING 提供「标记完成 / 取消 / 编辑」，终态只保留「删除」（物理删除，二次确认）。
 */
const PAGE_SIZE = 10

const STATUS_META = {
  PENDING: { label: '待面试', type: 'primary' },
  COMPLETED: { label: '已完成', type: 'success' },
  CANCELLED: { label: '已取消', type: 'info' },
  EXPIRED: { label: '已过期', type: 'warning' },
}

const TYPE_LABELS = { ONSITE: '现场', VIDEO: '视频', PHONE: '电话' }

const SOURCE_LABELS = { RULE: '规则解析', AI: 'AI 解析', MANUAL: '手工' }

const view = ref('list')
const loading = ref(true)
const loadError = ref('')
const records = ref([])
const total = ref(0)
const page = ref(1)
const statusFilter = ref('')

/** 日历当月数据（按月拉取） */
const calendarRecords = ref([])
let calendarMonth = dayjs().format('YYYY-MM')

const dialogVisible = ref(false)
/** null = 新建；对象 = 编辑 */
const editing = ref(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await listSchedules({
      page: page.value,
      size: PAGE_SIZE,
      status: statusFilter.value || undefined,
    })
    records.value = data.records ?? []
    total.value = data.total ?? 0
  }
  catch (error) {
    loadError.value = error.message
  }
  finally {
    loading.value = false
  }
}

/** 日历按月拉取（切换月份时由 ScheduleCalendar 触发） */
async function loadMonth(month) {
  calendarMonth = month
  const start = dayjs(`${month}-01`)
  try {
    const data = await listSchedules({
      page: 1,
      size: 100,
      from: start.format('YYYY-MM-DD'),
      to: start.endOf('month').format('YYYY-MM-DD'),
    })
    calendarRecords.value = data.records ?? []
  }
  catch {
    calendarRecords.value = []
  }
}

onMounted(async () => {
  await load()
  await loadMonth(calendarMonth)
})

/** 切换视图时刷新对应数据（日历首次进入时补拉当月） */
watch(view, async (value) => {
  if (value === 'calendar') {
    await loadMonth(calendarMonth)
  }
})

const timeText = (iso) => dayjs(iso).format('YYYY-MM-DD HH:mm')

/** 「今天 / 明天」前缀（临近提示） */
function dayHint(iso) {
  const target = dayjs(iso).startOf('day')
  const today = dayjs().startOf('day')
  if (target.isSame(today, 'day')) {
    return '今天 '
  }
  if (target.isSame(today.add(1, 'day'), 'day')) {
    return '明天 '
  }
  return ''
}

const statusOf = (item) => STATUS_META[item.status] ?? { label: item.status, type: 'info' }

async function refresh() {
  await load()
  if (view.value === 'calendar') {
    await loadMonth(calendarMonth)
  }
}

function reloadFromFirstPage() {
  page.value = 1
  load()
}

function changePage(nextPage) {
  page.value = nextPage
  load()
}

function openCreate() {
  editing.value = null
  dialogVisible.value = true
}

function openEdit(record) {
  editing.value = record
  dialogVisible.value = true
}

async function handleStatus(record, status) {
  const actionLabel = status === 'COMPLETED' ? '标记完成' : '取消'
  try {
    await ElMessageBox.confirm(
      `确定将「${record.companyName} · ${record.position}」${actionLabel}吗？`,
      '面试日程',
      { type: 'warning', confirmButtonText: actionLabel, cancelButtonText: '再想想' },
    )
  }
  catch {
    return
  }
  try {
    await updateScheduleStatus(record.id, status)
    ElMessage.success(`${actionLabel}成功`)
    await refresh()
  }
  catch (error) {
    ElMessage.error(error.message)
  }
}

async function handleDelete(record) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${record.companyName} · ${record.position}」吗？删除后不可恢复。`,
      '删除日程',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  }
  catch {
    return
  }
  try {
    await deleteSchedule(record.id)
    ElMessage.success('已删除')
    await refresh()
  }
  catch (error) {
    ElMessage.error(error.message)
  }
}
</script>

<template>
  <div class="schedules">
    <div class="page-head">
      <div class="page-head__row">
        <h1>面试日程</h1>
        <div class="page-head__actions">
          <el-segmented
            v-model="view"
            :options="[{ label: '列表', value: 'list' }, { label: '日历', value: 'calendar' }]"
          />
          <el-button type="primary" :icon="Plus" @click="openCreate">
            新建日程
          </el-button>
        </div>
      </div>
      <p class="page-head__hint">
        粘贴面试邀请自动识别公司、岗位与时间；全部状态自动流转（到点未处理将标记为已过期）。
      </p>
    </div>

    <StateBlock :loading="loading" :error="loadError" @retry="load">
      <!-- 列表视图 -->
      <template v-if="view === 'list'">
        <el-card shadow="never" class="card">
          <template #header>
            <div class="card__head">
              <h2>全部日程</h2>
              <el-select
                v-model="statusFilter"
                placeholder="全部状态"
                clearable
                size="small"
                style="width: 140px"
                @change="reloadFromFirstPage"
              >
                <el-option
                  v-for="(meta, key) in STATUS_META"
                  :key="key"
                  :label="meta.label"
                  :value="key"
                />
              </el-select>
            </div>
          </template>

          <el-empty v-if="!records.length" description="还没有面试日程，粘贴一条邀请试试" />
          <div v-else class="item-list">
            <div v-for="item in records" :key="item.id" class="item">
              <div class="item__main">
                <div class="item__title">
                  <span class="item__company">{{ item.companyName }}</span>
                  <span class="item__position">{{ item.position }}</span>
                  <el-tag size="small" effect="plain">
                    {{ TYPE_LABELS[item.interviewType] ?? item.interviewType }}
                  </el-tag>
                  <el-tag v-if="item.roundNumber > 1" size="small" effect="plain">
                    {{ item.roundNumber }} 轮
                  </el-tag>
                </div>
                <div class="item__meta">
                  <strong class="item__hint">{{ dayHint(item.interviewTime) }}</strong>{{ timeText(item.interviewTime) }}
                  <template v-if="item.meetingLink"> · {{ item.meetingLink }}</template>
                </div>
                <div class="item__meta item__meta--sub">
                  来源：{{ SOURCE_LABELS[item.parseSource] ?? item.parseSource }}
                  <template v-if="item.interviewer"> · 面试官：{{ item.interviewer }}</template>
                </div>
              </div>
              <div class="item__side">
                <el-tag :type="statusOf(item).type" size="small" effect="light">
                  {{ statusOf(item).label }}
                </el-tag>
                <div class="item__actions">
                  <template v-if="item.status === 'PENDING'">
                    <el-button size="small" type="primary" @click="handleStatus(item, 'COMPLETED')">
                      标记完成
                    </el-button>
                    <el-button size="small" @click="handleStatus(item, 'CANCELLED')">
                      取消
                    </el-button>
                    <el-button size="small" @click="openEdit(item)">
                      编辑
                    </el-button>
                  </template>
                  <el-button size="small" type="danger" plain @click="handleDelete(item)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </el-card>

        <div v-if="total > PAGE_SIZE" class="card__foot">
          <PaginationBar
            :total="total"
            :page="page"
            :size="PAGE_SIZE"
            @update:page="changePage"
          />
        </div>
      </template>

      <!-- 日历视图 -->
      <ScheduleCalendar
        v-else
        :schedules="calendarRecords"
        @month-change="loadMonth"
        @select="openEdit"
      />
    </StateBlock>

    <ScheduleFormDialog v-model="dialogVisible" :editing="editing" @saved="refresh" />
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 16px;
}

.page-head__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.page-head h1 {
  font-size: 22px;
}

.page-head__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-head__hint {
  font-size: 13px;
  color: var(--ink-400);
  margin-top: 4px;
}

.card {
  border-radius: var(--radius);
}

.card :deep(.el-card__body) {
  padding: 6px 18px;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card__head h2 {
  font-size: 17px;
}

.item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}

.item:last-child {
  border-bottom: none;
}

.item__main {
  min-width: 0;
}

.item__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.item__company {
  font-weight: 600;
  color: var(--ink-900);
}

.item__position {
  color: var(--ink-700);
}

.item__meta {
  font-size: 12px;
  color: var(--ink-500);
  margin-top: 6px;
  word-break: break-all;
}

.item__meta--sub {
  color: var(--ink-400);
}

.item__hint {
  color: var(--brand-600);
}

.item__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.item__actions {
  display: flex;
  gap: 8px;
}

.card__foot {
  margin-top: 16px;
}

@media (max-width: 900px) {
  .item {
    flex-direction: column;
  }

  .item__side {
    align-items: flex-start;
  }
}
</style>
