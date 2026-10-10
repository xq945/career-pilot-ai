<script setup>
import { Aim, ChatDotRound, ChatLineSquare, Document } from '@element-plus/icons-vue'

import BrandMark from '@/components/BrandMark.vue'

/**
 * 未认证页面布局（《前端原型设计》§5.1）：左品牌区（蓝色渐变） + 右表单卡。
 * ≤900px 时隐藏品牌区，表单居中 —— 窄屏下品牌内容只是装饰，不占用首屏。
 *
 * 登录与注册共用本布局：两者在原型中是同一页面的两个标签页，共享品牌区，
 * 拆成两个路由后这部分内容不应重复实现两份。
 */
const FEATURES = [
  { icon: Document, text: '简历智能分析：技能、经历、优势与改进建议' },
  { icon: Aim, text: '岗位匹配：五维评分与可追溯的匹配证据' },
  { icon: ChatLineSquare, text: '模拟面试：按岗位出题、逐题评分与参考答案' },
  { icon: ChatDotRound, text: '求职智能体：用对话完成分析与匹配，过程可追溯' },
]
</script>

<template>
  <div class="auth">
    <section class="auth__brand">
      <div class="auth__logo">
        <span class="auth__logo-mark"><BrandMark :size="22" /></span>
        <span class="auth__logo-text">智能求职辅助平台</span>
      </div>

      <div>
        <h1 class="auth__headline">让 AI 帮你把求职准备<br />做得更扎实</h1>
        <p class="auth__sub">
          基于 Spring AI 与 DeepSeek 的智能体应用。从简历诊断到岗位匹配，再到模拟面试，
          把每一步都变成有依据的改进建议。
        </p>

        <ul class="auth__feats">
          <li v-for="feature in FEATURES" :key="feature.text" class="auth__feat">
            <span class="auth__feat-ico">
              <el-icon><component :is="feature.icon" /></el-icon>
            </span>
            {{ feature.text }}
          </li>
        </ul>
      </div>

      <div class="auth__foot">本科毕业设计 · 基于 Spring AI 的智能体应用开发</div>
    </section>

    <section class="auth__panel">
      <div class="auth__card">
        <slot />

        <p class="auth__note">登录状态保存在浏览器本地，简历与岗位数据仅本人可见</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.auth {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  min-height: 100vh;
}

/* ---- 左：品牌区 ---- */
.auth__brand {
  background:
    radial-gradient(900px 460px at 12% 8%, rgba(255, 255, 255, 0.16), transparent 62%),
    linear-gradient(160deg, #1e40af 0%, #2563eb 46%, #3b82f6 100%);
  color: #fff;
  padding: 56px 60px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.auth__logo {
  display: flex;
  align-items: center;
  gap: 11px;
}

.auth__logo-mark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth__logo-text {
  font-size: 16px;
  font-weight: 600;
}

.auth__headline {
  font-size: 32px;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
  color: #fff;
}

.auth__sub {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 14px;
  max-width: 400px;
  line-height: 1.75;
}

.auth__feats {
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin: 30px 0 0;
  padding: 0;
  list-style: none;
}

.auth__feat {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.9);
}

.auth__feat-ico {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth__foot {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

/* ---- 右：表单区 ---- */
.auth__panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  background: var(--bg);
}

.auth__card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 30px 30px 26px;
}

.auth__note {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-500);
}

@media (max-width: 900px) {
  .auth {
    grid-template-columns: 1fr;
  }

  .auth__brand,
  .auth__foot {
    display: none;
  }
}
</style>
