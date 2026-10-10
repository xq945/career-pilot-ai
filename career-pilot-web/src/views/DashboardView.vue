<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'

import { useUserStore } from '@/stores/user'

/**
 * 仪表盘占位页。
 *
 * 路由 /dashboard 与《前端原型设计》§1.1 一致，但本次里程碑只交付认证闭环，
 * 仪表盘所需的 GET /api/dashboard/summary 尚未实现（《API接口设计》§9），
 * 故此处不请求任何业务数据，仅展示当前登录用户资料 —— 它同时是
 * GET /api/user/profile 是否可用的现场证据。后续里程碑直接替换页面内容即可，
 * 路由结构无需改动。
 */
const userStore = useUserStore()

const refreshing = ref(false)

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) {
    return '凌晨好'
  }
  if (hour < 12) {
    return '早上好'
  }
  if (hour < 18) {
    return '下午好'
  }
  return '晚上好'
})

const profileFields = computed(() => [
  { label: '用户 ID', value: userStore.user?.id ?? '—' },
  { label: '用户名', value: userStore.user?.username ?? '—' },
  { label: '邮箱', value: userStore.user?.email ?? '—' },
  { label: '昵称', value: userStore.user?.nickname ?? '—' },
])

async function handleRefresh() {
  refreshing.value = true
  try {
    await userStore.fetchProfile()
    ElMessage.success('资料已刷新')
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ greeting }}，{{ userStore.displayName }}</h1>
        <p class="page-head__desc">这里是你的求职准备进度总览。</p>
      </div>
    </div>

    <el-card shadow="never" class="card">
      <template #header>
        <div class="card__head">
          <h2>当前账号</h2>
          <el-button :icon="Refresh" :loading="refreshing" @click="handleRefresh">
            刷新资料
          </el-button>
        </div>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item
          v-for="field in profileFields"
          :key="field.label"
          :label="field.label"
        >
          {{ field.value }}
        </el-descriptions-item>
      </el-descriptions>

      <p class="hint">
        以上数据来自 <code>GET /api/user/profile</code>（《API接口设计》3.3），
        用户身份由后端从 Token 解析，前端不传任何用户标识。
      </p>
    </el-card>

    <el-card shadow="never" class="card">
      <template #header>
        <h2>后续里程碑</h2>
      </template>
      <p class="hint">
        本次交付范围为基础框架与用户认证。仪表盘统计、简历管理、岗位匹配、AI 面试与
        求职智能体将在后续里程碑接入，对应接口见《API接口设计》。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 20px;
}

.page-head__desc {
  font-size: 13px;
  color: var(--ink-500);
  margin-top: 4px;
}

.card {
  border-radius: var(--radius);
  margin-bottom: 16px;
}

.card :deep(.el-card__header) {
  padding: 14px 18px;
}

.card :deep(.el-card__body) {
  padding: 18px;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hint {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-500);
}

.hint code {
  font-size: 12px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
}
</style>
