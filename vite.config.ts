import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

// 使用相对路径 base，保证 GitHub Pages 子路径与本地静态服务均可正确解析资源
export default defineConfig({
  base: './',
  plugins: [vue(), cesium()],
  build: {
    chunkSizeWarningLimit: 4000
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
} as never)
