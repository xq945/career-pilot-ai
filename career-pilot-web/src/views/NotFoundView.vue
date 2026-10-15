<script setup>
import { useUserStore } from '@/stores/user'

/**
 * 404 页。作为兜底路由，未登录与已登录都会到达，故按登录态给出不同的返回入口。
 */
const userStore = useUserStore()
</script>

<template>
  <div class="not-found">
    <el-result icon="warning" title="404" sub-title="页面不存在或已被移除">
      <template #extra>
        <el-button type="primary" @click="$router.replace(userStore.isLoggedIn ? '/dashboard' : '/login')">
          {{ userStore.isLoggedIn ? '返回工作台' : '去登录' }}
        </el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
</style>
