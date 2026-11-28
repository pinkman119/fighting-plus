import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Web 端开发服务器（默认 5173）：
 * /api、/live、/ws 代理到 NestJS（默认 3118），生产环境由服务端直接托管 dist。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const server = env.FP_SERVER_URL || process.env.FP_SERVER_URL || 'http://localhost:3118';
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        '/api': { target: server, changeOrigin: true },
        '/live': { target: server, changeOrigin: true },
        '/ws': { target: server.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      },
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1500,
    },
  };
});
