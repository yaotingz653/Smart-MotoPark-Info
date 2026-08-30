import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // NOTE: 開放所有來源（含手機 IP），讓區域網路內的手機可以連線
      allowedHosts: true,
      proxy: {
        '/api': {
          // NOTE: 使用 127.0.0.1 而非 localhost，避免 Windows 把 localhost 解析成 IPv6 的 ::1
          // uvicorn 預設只監聽 127.0.0.1 (IPv4)，導致 ECONNREFUSED 錯誤
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
  };
});
