import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

/**
 * 桌面客户端构建配置：
 * - main / preload：Electron 主进程与预加载脚本
 * - renderer：薄入口，界面代码直接复用 apps/frontend（与 Web 端同一套界面）
 *   依赖（vue / mpegts.js）由 frontend 文件所在目录解析，保证只有一份 Vue 运行时。
 */
const frontend = resolve(__dirname, '../frontend');

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(frontend, 'src'),
        // client/node_modules 里会被动带上另一份 vue（@vitejs/plugin-vue 的依赖），
        // 这里统一指向 frontend 的运行时，避免打包两份 Vue 导致响应式失效
        '^vue$': resolve(frontend, 'node_modules/vue/dist/vue.runtime.esm-bundler.js'),
      },
      dedupe: ['vue'],
    },
    server: {
      // 与 Web 开发服务器（5173）分开，避免重启 Web 时影响客户端
      port: 5174,
      strictPort: true,
      fs: {
        allow: [resolve(__dirname, '../..')],
      },
    },
    build: {
      target: 'es2020',
      minify: 'esbuild',
      chunkSizeWarningLimit: 1500,
    },
    // 生产构建去掉 Vue 的开发期警告与分支
    define: mode === 'production' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  },
}));
