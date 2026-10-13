import { createRouter, createWebHistory } from 'vue-router'

import AppLayout from '@/layouts/AppLayout.vue'
import { useUserStore } from '@/stores/user'

/**
 * 路由表（《前端原型设计》§1.1）。
 *
 * 本次里程碑只实现认证闭环与仪表盘占位；其余页面在后续里程碑逐个补入 children，
 * 侧边栏 AppLayout 中的对应项届时把 ready 改为 true。
 *
 * `meta.public` 标记公开路由，守卫据此区分。注意：**前端守卫只影响用户体验**，
 * 真正的权限判定在后端（Spring Security 对 /api/** 一律要求认证，
 * 且用户身份取自 Token，见《系统架构设计》7 节）—— 绕过守卫也拿不到数据。
 */
const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { public: true, title: '注册' },
  },
  {
    path: '/',
    component: AppLayout,
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '仪表盘', group: '总览' },
      },
      {
        path: 'agent',
        name: 'agent',
        component: () => import('@/views/AgentView.vue'),
        meta: { title: '求职智能体', group: '总览' },
      },
      {
        path: 'resumes',
        name: 'resumes',
        component: () => import('@/views/ResumesView.vue'),
        meta: { title: '简历管理', group: '求职材料' },
      },
      {
        path: 'resumes/:id/analysis',
        name: 'resume-analysis',
        component: () => import('@/views/ResumeAnalysisView.vue'),
        meta: { title: '简历 AI 分析', group: '求职材料' },
      },
      {
        path: 'jobs',
        name: 'jobs',
        component: () => import('@/views/JobsView.vue'),
        meta: { title: '岗位管理', group: '求职材料' },
      },
      {
        path: 'jobs/:id/analysis',
        name: 'job-analysis',
        component: () => import('@/views/JobAnalysisView.vue'),
        meta: { title: '岗位 AI 分析', group: '求职材料' },
      },
      {
        path: 'optimizations',
        name: 'optimizations',
        component: () => import('@/views/OptimizationsView.vue'),
        meta: { title: '简历定向优化', group: 'AI 分析与练习' },
      },
      {
        path: 'optimizations/:id',
        name: 'optimization-detail',
        component: () => import('@/views/OptimizationDetailView.vue'),
        meta: { title: '优化工作台', group: 'AI 分析与练习' },
      },
      {
        path: 'interviews',
        name: 'interviews',
        component: () => import('@/views/InterviewsView.vue'),
        meta: { title: 'AI 面试', group: 'AI 分析与练习' },
      },
      {
        path: 'interviews/:id',
        name: 'interview-session',
        component: () => import('@/views/InterviewSessionView.vue'),
        meta: { title: '模拟面试答题', group: 'AI 分析与练习' },
      },
      {
        path: 'interviews/:id/report',
        name: 'interview-report',
        component: () => import('@/views/InterviewReportView.vue'),
        meta: { title: '面试报告', group: 'AI 分析与练习' },
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/ProfileView.vue'),
        meta: { title: '个人中心', group: '账号' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * 全局前置守卫（《前端原型设计》§7.3）。
 *
 * 注意 useUserStore() 必须在守卫回调内调用：模块顶层执行时 Pinia 尚未安装。
 */
router.beforeEach(async (to) => {
  const userStore = useUserStore()

  if (to.meta.public) {
    // 已登录用户不应再看到登录/注册页
    if (userStore.isLoggedIn && (to.name === 'login' || to.name === 'register')) {
      return { name: 'dashboard' }
    }
    return true
  }

  if (!userStore.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // 已登录但资料尚未确认（典型场景：刷新页面，内存状态已丢失、Token 仍在）
  // → 向后端确认 Token 是否仍然有效，而不是仅凭 localStorage 里有值就放行。
  if (!userStore.profileLoaded) {
    const restored = await userStore.restore()
    if (restored === false) {
      // Token 被后端判定为无效（过期、被篡改、服务端换了密钥）
      return { name: 'login', query: { redirect: to.fullPath } }
    }
    // restored === null 表示网络不可达、无法确认。此时保留本地登录态放行 ——
    // 若在此处强制登出，后端未启动时用户会被无故踢下线，看到的信息也是错的。
  }

  return true
})

/** 页面标题统一格式：`页面名 · 智能求职辅助平台`（《前端原型设计》§2.5） */
router.afterEach((to) => {
  const appTitle = import.meta.env.VITE_APP_TITLE || '智能求职辅助平台'
  document.title = to.meta.title ? `${to.meta.title} · ${appTitle}` : appTitle
})

export default router
