import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
const port = Number(process.env.SR_WEB_PORT || 5173);
const apiTarget = process.env.SR_API_TARGET || 'http://127.0.0.1:2567';
export default defineConfig({
  plugins: [vue()],
  server: { host: '0.0.0.0', port, strictPort: true, proxy: { '/api': apiTarget } },
  preview: { host: '0.0.0.0', port, strictPort: true, proxy: { '/api': apiTarget } }
});
