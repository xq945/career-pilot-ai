import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 与《系统架构设计》7.2 节的 CORS 允许来源保持一致
    port: 5173,
    // 头像等公开文件由后端 /uploads/** 提供（《系统架构设计》7.1）：
    // 不代理的话，<img src="/uploads/..."> 会请求 Vite 自身（5173）而 404。
    // target 与 .env 的 VITE_API_BASE_URL 保持同一后端；生产同源部署时无需此代理。
    proxy: {
      '/uploads': { target: 'http://localhost:8080' },
    },
  },
})
