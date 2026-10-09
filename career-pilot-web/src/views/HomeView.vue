<script setup>
import { ref } from 'vue'

const stack = ref([
  'Vue 3',
  'Vite',
  'Vue Router',
  'Pinia',
  'Element Plus',
  'Axios',
])
</script>

<template>
  <div class="home">
    <el-card>
      <template #header>
        <h1>智能求职辅助平台</h1>
      </template>
      <p>前端工程已启动，技术栈：</p>
      <div class="stack">
        <el-tag v-for="item in stack" :key="item" type="success" effect="plain">
          {{ item }}
        </el-tag>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.home {
  max-width: 720px;
  margin: 48px auto;
  padding: 0 16px;
}

.home h1 {
  margin: 0;
  font-size: 20px;
}

.stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
</style>
