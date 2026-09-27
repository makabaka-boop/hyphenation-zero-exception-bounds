import { defineConfig } from 'vite';

// 纯静态离线页面：构建产物可由任意静态服务器（Compose 中的 hyphen 服务）托管
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  preview: { port: 8080, host: true },
  build: { outDir: 'dist', sourcemap: true }
});
