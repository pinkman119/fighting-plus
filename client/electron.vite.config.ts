import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, '../../shared')
      }
    },
    server: {
      fs: {
        // 允许引用仓库根部的 shared/ 类型文件
        allow: ['..', resolve(__dirname, '../../shared')]
      }
    }
  }
})
