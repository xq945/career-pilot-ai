<script setup>
/**
 * 分析状态标签（《前端原型设计》§8.2、§10.1）。
 *
 * M3 阶段简历列表只有两种状态：未分析 / 已分析（列表接口的 analyzed 字段直接驱动，
 * 无需逐条追加分析接口请求）。M4 起扩展「分析中」，M5 起由岗位模块扩展「分析已过期」。
 */
defineProps({
  analyzed: { type: Boolean, default: false },
})
</script>

<template>
  <el-tag v-if="analyzed" type="success" size="small" effect="light">
    已分析
  </el-tag>
  <el-tag v-else type="info" size="small" effect="light">
    未分析
  </el-tag>
</template>
