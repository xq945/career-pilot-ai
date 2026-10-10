<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Aim,
  ArrowDown,
  Briefcase,
  ChatDotRound,
  ChatLineSquare,
  Document,
  Odometer,
  SwitchButton,
  User,
} from '@element-plus/icons-vue'

import BrandMark from '@/components/BrandMark.vue'
import { useUserStore } from '@/stores/user'

/**
 * 应用骨架（《前端原型设计》§3）：左侧固定侧边栏 232px + 顶栏 56px + 内容区。
 *
 * 例外页面不套用本布局：登录 / 注册用 AuthLayout（左右分栏）。
 *
 * 导航按 §1.2 的四组结构渲染。未实现的项以 disabled 呈现，避免点击落到未实现的路由
 * 而报 404 —— 后续模块实现时把 ready 改为 true 即可（已点亮：仪表盘、个人中心）。
 */
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const NAV_GROUPS = [
  {
    label: '总览',
    items: [
      { path: '/dashboard', text: '仪表盘', icon: Odometer, ready: true },
      { path: '/agent', text: '求职智能体', icon: ChatDotRound, ready: false },
    ],
  },
  {
    label: '求职材料',
    items: [
      { path: '/resumes', text: '简历管理', icon: Document, ready: true },
      { path: '/jobs', text: '岗位管理', icon: Briefcase, ready: false },
    ],
  },
  {
    label: 'AI 分析与练习',
    items: [
      { path: '/matches', text: '岗位匹配', icon: Aim, ready: false },
      { path: '/interviews', text: 'AI 面试', icon: ChatLineSquare, ready: false },
    ],
  },
  {
    label: '账号',
    items: [{ path: '/profile', text: '个人中心', icon: User, ready: true }],
  },
]

/** 当前高亮项。详情页（如 /resumes/3/analysis）应高亮其列表项 */
const activeNav = computed(() => {
  const matched = NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => item.ready)
    .find((item) => route.path === item.path || route.path.startsWith(`${item.path}/`))
  return matched?.path ?? route.path
})

/** 面包屑：分组 / 页面名（《前端原型设计》§3） */
const breadcrumb = computed(() => {
  const group = route.meta?.group
  const title = route.meta?.title
  return [group, title].filter(Boolean)
})

/** 头像图片加载失败时回退为首字符占位（记录失败的 URL，换新头像后自动恢复尝试） */
const brokenAvatar = ref('')

const showAvatarImage = computed(() => {
  const url = userStore.user?.avatar
  return Boolean(url) && url !== brokenAvatar.value
})

function handleCommand(command) {
  if (command === 'logout') {
    handleLogout()
  }
  else if (command === 'profile') {
    router.push({ name: 'profile' })
  }
}

async function handleLogout() {
  await userStore.logout()
  ElMessage.success('已退出登录')
  // 用 replace 而非 push：后退不应回到需要登录的页面
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar__brand">
        <BrandMark :size="28" />
        <span class="sidebar__title">智能求职辅助平台</span>
      </div>

      <el-menu class="sidebar__nav" :default-active="activeNav" router>
        <!-- el-menu-item-group 的标题即导航分组名 -->
        <el-menu-item-group v-for="group in NAV_GROUPS" :key="group.label" :title="group.label">
          <el-menu-item
            v-for="item in group.items"
            :key="item.path"
            :index="item.path"
            :disabled="!item.ready"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.text }}</span>
            <span v-if="!item.ready" class="nav-item__pending">待实现</span>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>

      <div class="sidebar__foot">本科毕业设计 · 基于 Spring AI</div>
    </aside>

    <div class="main">
      <header class="topbar">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item v-for="(crumb, index) in breadcrumb" :key="index">
            {{ crumb }}
          </el-breadcrumb-item>
        </el-breadcrumb>

        <div class="topbar__spacer" />

        <el-dropdown trigger="click" @command="handleCommand">
          <button class="topbar__user" type="button">
            <img
              v-if="showAvatarImage"
              class="topbar__avatar topbar__avatar--img"
              :src="userStore.user.avatar"
              alt=""
              @error="brokenAvatar = userStore.user.avatar"
            >
            <span v-else class="topbar__avatar">{{ userStore.initial }}</span>
            <span class="topbar__user-name">{{ userStore.displayName }}</span>
            <el-icon class="topbar__caret"><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>
                {{ userStore.user?.username || '未登录' }}
              </el-dropdown-item>
              <el-dropdown-item command="profile">
                <el-icon><User /></el-icon>
                个人中心
              </el-dropdown-item>
              <el-dropdown-item divided command="logout">
                <el-icon><SwitchButton /></el-icon>
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="content">
        <div class="content__inner">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}

/* ---- 侧边栏 ---- */
.sidebar {
  width: var(--sidebar-w);
  flex: 0 0 var(--sidebar-w);
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar__brand {
  height: var(--topbar-h);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
}

.sidebar__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
  white-space: nowrap;
}

/* el-menu 默认自带右边框与背景色，此处对齐原型：白底、无边框、主色浅底激活态 */
.sidebar__nav {
  flex: 1;
  overflow-y: auto;
  border-right: none;
  padding: 8px 10px;
  --el-menu-item-height: 40px;
  --el-menu-item-font-size: 14px;
  --el-menu-bg-color: transparent;
  --el-menu-hover-bg-color: var(--brand-50);
  --el-menu-text-color: var(--ink-700);
  --el-menu-active-color: var(--brand-600);
}

.sidebar__nav :deep(.el-menu-item) {
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
}

.sidebar__nav :deep(.el-menu-item.is-active) {
  background: var(--brand-50);
  font-weight: 500;
}

.sidebar__nav :deep(.el-menu-item-group__title) {
  font-size: 12px;
  color: var(--ink-400);
  padding: 14px 12px 6px;
}

.nav-item__pending {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-400);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 7px;
  line-height: 17px;
}

.sidebar__foot {
  flex: 0 0 auto;
  padding: 14px 18px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-400);
}

/* ---- 主区 ---- */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: var(--topbar-h);
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  /* 毛玻璃：滚动内容从下方经过时保持可读（《前端原型设计》§3） */
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
}

.topbar__spacer {
  flex: 1;
}

.topbar__user {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  color: var(--ink-700);
  cursor: pointer;
  transition: background 0.15s;
}

.topbar__user:hover {
  background: var(--brand-50);
}

.topbar__avatar {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 50%;
  background: var(--brand-600);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

/* 头像图片复用占位块的 26px 圆形尺寸 */
.topbar__avatar--img {
  object-fit: cover;
}

.topbar__caret {
  color: var(--ink-400);
  font-size: 12px;
}

.content {
  flex: 1;
  padding: 24px;
}

.content__inner {
  max-width: var(--content-max);
  margin: 0 auto;
}

/* 窄屏：侧边栏收起为图标条，与原型 §2.3 的响应式约定一致 */
@media (max-width: 900px) {
  .sidebar {
    width: 64px;
    flex-basis: 64px;
  }

  .sidebar__title,
  .nav-item__pending,
  .sidebar__foot {
    display: none;
  }

  .sidebar__brand {
    justify-content: center;
    padding: 0;
  }

  .sidebar__nav :deep(.el-menu-item span) {
    display: none;
  }

  .topbar__user-name {
    display: none;
  }
}
</style>
