import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ofAllowed, ofPathOf } from './api/_allow'

// No keys live here. The browser sends the visitor's own OpenFinance key in
// x-api-key; the dev proxy below mirrors the production edge function
// api/of.ts, including its route allowlist (anything else is a 404).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3143,
    strictPort: true,
    proxy: {
      '/api/of': {
        target: 'https://api.openfinance.tech',
        changeOrigin: true,
        bypass: (req) => (ofAllowed(req.method ?? 'GET', ofPathOf(req.url ?? '')) ? undefined : false),
        rewrite: (p) => '/' + ofPathOf(p),
        // OpenFinance unreachable (network drop): answer 502 with a reason
        // instead of Vite's empty 500, same as the production edge function.
        configure: (proxy) =>
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res && !res.headersSent && !res.writableEnded) {
              res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'upstream unreachable' }))
            }
          }),
      },
    },
  },
})
