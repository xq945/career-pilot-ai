<script setup>
/**
 * 逐项修改说明（《前端原型设计》§5.8 区块 ⑦）。
 *
 * 每条 = 类型标签（改写 / 补关键词 / 调整顺序 / 精简）+ 原因 + 修改前 / 修改后对照。
 * before 是"真实性"的对照锚点：用户可据此核对模型没有把简历里没有的东西写进去。
 * type 为 null（模型未给出或清洗置空）时按"调整"展示。
 */
defineProps({
  /** changes 数组（接口 §6A.1 的元素结构：{section, type, reason, before, after}） */
  changes: { type: Array, default: () => [] },
})

/** 改动类型的中文标签（接口下发英文枚举，展示映射在前端） */
const TYPE_LABELS = {
  REWRITE: '改写',
  KEYWORD: '补关键词',
  REORDER: '调整顺序',
  TRIM: '精简',
}

const TYPE_TAG = {
  REWRITE: 'primary',
  KEYWORD: 'success',
  REORDER: 'warning',
  TRIM: 'info',
}

const typeLabel = (type) => TYPE_LABELS[type] ?? '调整'

const typeTag = (type) => TYPE_TAG[type] ?? 'info'
</script>

<template>
  <div class="changes">
    <div v-for="(item, index) in changes" :key="index" class="change">
      <div class="change__head">
        <el-tag size="small" :type="typeTag(item.type)" effect="light">
          {{ typeLabel(item.type) }}
        </el-tag>
        <span class="change__section">{{ item.section }}</span>
      </div>
      <p v-if="item.reason" class="change__reason">{{ item.reason }}</p>
      <div class="change__compare">
        <div class="change__col change__col--before">
          <span class="change__label">修改前</span>
          <p class="change__text">{{ item.before || '（原文无此内容）' }}</p>
        </div>
        <div class="change__col change__col--after">
          <span class="change__label">修改后</span>
          <p class="change__text">{{ item.after }}</p>
        </div>
      </div>
    </div>
    <p v-if="changes.length === 0" class="changes__empty">
      本次优化没有产生逐项修改记录。
    </p>
  </div>
</template>

<style scoped>
.changes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.change {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}

.change__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.change__section {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-900);
}

.change__reason {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-500);
}

.change__compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

@media (max-width: 900px) {
  .change__compare {
    grid-template-columns: 1fr;
  }
}

.change__col {
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.change__col--before {
  background: var(--bg);
}

.change__col--after {
  background: var(--brand-50);
}

.change__label {
  font-size: 12px;
  color: var(--ink-400);
}

.change__text {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-700);
  white-space: pre-wrap;
  word-break: break-word;
}

.changes__empty {
  font-size: 13px;
  color: var(--ink-400);
}
</style>
