<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Aim,
  ArrowDown,
  Briefcase,
  Calendar,
  ChatDotRound,
  ChatLineSquare,
  Document,
  Expand,
  Fold,
  Odometer,
  SwitchButton,
  User,
} from '@element-plus/icons-vue'

import BrandMark from '@/components/BrandMark.vue'
import { useUserStore } from '@/stores/user'

/**
 * 应用骨架（《前端原型设计》§3）：左侧固定侧边栏 232px（可折叠为 64px 图标条）+ 顶栏 56px + 内容区。
 *
 * 例外页面不套用本布局：登录 / 注册用 AuthLayout（左右分栏）。
 *
 * 导航为平铺列表（原型 §1.2 的四组分组已按要求合并）。`ready: false` 的项以 disabled 呈现，
 * 避免点击落到未实现的路由而报 404 —— 全部模块均已实现，当前所有项均已点亮。
 */
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const NAV_ITEMS = [
  { path: '/dashboard', text: '工作台', icon: Odometer, ready: true },
  { path: '/agent', text: '求职智能体', icon: ChatDotRound, ready: true },
  { path: '/resumes', text: '简历管理', icon: Document, ready: true },
  { path: '/jobs', text: '岗位管理', icon: Briefcase, ready: true },
  { path: '/optimizations', text: '简历定向优化', icon: Aim, ready: true },
  { path: '/interviews', text: 'AI 面试', icon: ChatLineSquare, ready: true },
  { path: '/schedules', text: '面试日程', icon: Calendar, ready: true },
  { path: '/profile', text: '个人中心', icon: User, ready: true },
]

/** 当前高亮项。详情页（如 /resumes/3/analysis）应高亮其列表项 */
const activeNav = computed(() => {
  const matched = NAV_ITEMS
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

/** 侧边栏是否收起为图标条（品牌区的开关按钮切换；窄屏的自动折叠见样式末尾的媒体查询） */
const collapsed = ref(false)

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
    <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
      <div class="sidebar__brand">
        <BrandMark class="sidebar__logo" :size="28" />
        <span class="sidebar__title">智能求职辅助平台</span>
        <button
          class="sidebar__toggle"
          type="button"
          :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
          :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        >
          <el-icon><component :is="collapsed ? Expand : Fold" /></el-icon>
        </button>
      </div>

      <el-menu
        class="sidebar__nav"
        :default-active="activeNav"
        :collapse="collapsed"
        router
      >
        <el-menu-item
          v-for="item in NAV_ITEMS"
          :key="item.path"
          :index="item.path"
          :disabled="!item.ready"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <!-- 文字写进 #title 插槽：折叠态 el-menu 用它渲染浮层提示；留在默认插槽只会被收成图标 -->
          <template #title>
            <span>{{ item.text }}</span>
            <span v-if="!item.ready" class="nav-item__pending">待实现</span>
          </template>
        </el-menu-item>
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
        <router-view />
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
  /* 折叠开关切换宽度时平滑过渡；el-menu 的宽度跟随容器，无需单独过渡 */
  transition: width 0.2s ease, flex-basis 0.2s ease;
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
  /* 14px：与导航文字一致；15px + 开关按钮在 232px 内会被省略号截断 */
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-900);
  white-space: nowrap;
  /* 与开关按钮同行：空间不足时省略标题，不挤压按钮 */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 折叠开关：与顶栏的次要控件同一套灰度与悬停反馈 */
.sidebar__toggle {
  margin-left: auto;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-400);
  font-size: 16px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.sidebar__toggle:hover {
  background: var(--brand-50);
  color: var(--brand-600);
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

/* ---- 折叠态（图标条）----
   与窄屏媒体查询的自动折叠同形；宽度取 token，与 el-menu 自算的折叠宽度一致 */
.sidebar--collapsed {
  width: var(--sidebar-w-collapsed);
  flex-basis: var(--sidebar-w-collapsed);
}

/* 64px 放不下品牌标记与开关两个 28px 元素，标记让位给开关（点击它即展开） */
.sidebar--collapsed .sidebar__brand {
  justify-content: center;
  padding: 0;
}

/* 只隐品牌标记：不能写 `.sidebar__brand svg` —— 开关按钮里的图标也是 svg，会一起被藏掉 */
.sidebar--collapsed .sidebar__logo,
.sidebar--collapsed .sidebar__title,
.sidebar--collapsed .sidebar__foot {
  display: none;
}

/* auto 外边距优先于 justify-content，须显式取消开关才能居中 */
.sidebar--collapsed .sidebar__toggle {
  margin-left: 0;
}

/* el-menu 的折叠对齐只作用于「直接子级」菜单项，本项目的项都在分组内，需自行居中 */
.sidebar--collapsed .sidebar__nav :deep(.el-menu-item) {
  justify-content: center;
  padding: 0;
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
    width: var(--sidebar-w-collapsed);
    flex-basis: var(--sidebar-w-collapsed);
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

  /* 此时已是自动图标条，手动开关既无位置也无可操作空间 */
  .sidebar__toggle {
    display: none;
  }

  .sidebar__nav :deep(.el-menu-item span) {
    display: none;
  }

  /* 与折叠态同形：图标居中 */
  .sidebar__nav :deep(.el-menu-item) {
    justify-content: center;
    padding: 0;
  }

  .topbar__user-name {
    display: none;
  }
}
</style>
