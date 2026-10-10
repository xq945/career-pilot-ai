<script setup>
/**
 * 分析状态标签（《前端原型设计》§8.2、§10.1）。
 *
 * 四种状态：
 * - 未分析 / 已分析：由列表或详情接口的 `analyzed` 字段直接驱动（无需逐条追加请求）；
 * - 分析已过期（M5）：`analyzed && stale`——分析仍存在，但基于**旧版岗位描述**
 *   （描述在分析后被修改过）。仅岗位模块有该状态：简历文本入库后不可变，
 *   不存在过期场景（《API接口设计》5.2）；
 * - 分析中（M4）：**仅表示「本次页面内已发起、等待结果」**——服务端只保存成功结果
 *   （《数据库设计》5.3），不存在"分析中"这一持久状态，因此列表接口永远不会返回它。
 */
defineProps({
  analyzed: { type: Boolean, default: false },
  analyzing: { type: Boolean, default: false },
  /** 分析已过期（后端 `stale`）：`analyzed = false` 时后端恒返回 false */
  stale: { type: Boolean, default: false },
})
</script>

<template>
  <el-tag v-if="analyzing" type="info" size="small" effect="light">
    <span class="tag-spinner" />分析中
  </el-tag>
  <el-tag v-else-if="analyzed && stale" type="warning" size="small" effect="light">
    分析已过期
  </el-tag>
  <el-tag v-else-if="analyzed" type="success" size="small" effect="light">
    已分析
  </el-tag>
  <el-tag v-else type="info" size="small" effect="light">
    未分析
  </el-tag>
</template>

<style scoped>
/* 标签内的小圆环（原型 §5.3 的「分析中」形态：tag--info + 内联 spinner） */
.tag-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 5px;
  vertical-align: -1px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: tag-spin 0.8s linear infinite;
}

@keyframes tag-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
