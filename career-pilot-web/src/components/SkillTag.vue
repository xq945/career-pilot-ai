<script setup>
import { computed } from 'vue'

/**
 * 技能卡（《前端原型设计》§4.3、§8.2）：技能名 + 掌握程度标签 + 一句证据。
 *
 * 对应简历分析结果的 `skills[{ name, level, evidence }]`；等级语义色按
 * 「已体现」（有项目/经历支撑，绿）与「仅提及」（仅列出名称，黄）区分，其余为中性灰。
 * M6 的匹配报告会复用该组件的名称 + 等级呈现方式（匹配/部分匹配/未体现另行映射颜色）。
 */
const props = defineProps({
  name: { type: String, required: true },
  /** 掌握程度描述（由模型输出，如「已体现」「仅提及」「熟悉」） */
  level: { type: String, default: '' },
  /** 简历中的依据（简短引用） */
  evidence: { type: String, default: '' },
})

/** 等级 → 语义色：只在识别到约定措辞时着色，避免对自由文本过度解读 */
const levelType = computed(() => {
  const level = props.level || ''
  if (level.includes('已体现')) {
    return 'success'
  }
  if (level.includes('仅提及')) {
    return 'warning'
  }
  return 'info'
})
</script>

<template>
  <div class="skill-tag">
    <div class="skill-tag__head">
      <span class="skill-tag__name">{{ name }}</span>
      <el-tag v-if="level" :type="levelType" size="small" effect="light">
        {{ level }}
      </el-tag>
    </div>
    <p v-if="evidence" class="skill-tag__evidence">
      {{ evidence }}
    </p>
  </div>
</template>

<style scoped>
.skill-tag {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}

.skill-tag__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.skill-tag__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-tag__evidence {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-500);
}
</style>
