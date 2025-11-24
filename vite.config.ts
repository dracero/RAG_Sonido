import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';



export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  console.log('Vite Proxy Target:', env.QDRANT_URL); // Debug log

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/qdrant': {
          target: env.QDRANT_URL,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api\/qdrant/, ''),
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('proxy error', err);
            });
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              console.log('Sending Request to the Target:', req.method, req.url);
            });
            proxy.on('proxyRes', (proxyRes, req, _res) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
            });
          },
        },
      },
    },
    plugins: [basicSsl()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.QDRANT_URL': JSON.stringify('/api/qdrant'),
      'process.env.QDRANT_API_KEY': JSON.stringify(env.QDRANT_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
