import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          secure: false,
        },
        '/ecourts-proxy': {
          target: env.VITE_ECOURTS_API_BASE_URL || 'https://api.ecourtsindia.gov.in',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ecourts-proxy/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.VITE_ECOURTS_API_KEY || ''}`);
            });
          },
        },
      },
    },
  };
})
