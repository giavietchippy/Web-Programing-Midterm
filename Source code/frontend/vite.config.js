import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies REST + WebSocket to the other members' backends,
// so the browser only ever talks to http://localhost:5173 (same origin, no CORS).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.DEV_API_TARGET || 'http://localhost:3000'; // Member 3 (REST)
  const rt = env.DEV_WS_TARGET || 'http://localhost:3001';   // Member 2 (WebSocket)
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/ws': { target: rt, ws: true, changeOrigin: true },
        // Real-time admin HTTP API. "/admin" itself is a React route, so the browser uses "/realtime/admin/*".
        '/realtime': { target: rt, changeOrigin: true, rewrite: (p) => p.replace(/^\/realtime/, '') },
        '/dev': { target: rt, changeOrigin: true } // dev-only POST /dev/token
      }
    }
  };
});
