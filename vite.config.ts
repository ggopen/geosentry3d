import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

// 使用相对路径 base，保证 GitHub Pages 子路径与本地静态服务均可正确解析资源
export default defineConfig({
  base: './',
  define: {
    // 每次发布时版本号随 package.json 递增，构建日期自动写入，页面显眼位置展示
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
  },
  plugins: [vue(), cesium()],
  build: {
    chunkSizeWarningLimit: 4000
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
} as never)
