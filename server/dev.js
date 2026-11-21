/**
 * Mode développement : Vite en middleware (HMR) + API Express sur un seul port.
 * `npm run dev` → http://localhost:5173
 */
import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createRouter } from './api.js';
import { demoRouter } from './demo.js';
import { config } from './config.js';
import { attachViewer } from './viewer-ws.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(createRouter());
app.use('/demo', demoRouter());

const vite = await createViteServer({
  server: { middlewareMode: true, allowedHosts: true, hmr: { server: undefined } },
  appType: 'spa',
});
app.use(vite.middlewares);

const server = http.createServer(app);
attachViewer(server);

const port = Number(process.env.DEV_PORT || 5173);
server.listen(port, config.host, () => {
  console.log(`[web-ia] dev sur http://${config.host}:${port} (jeton: ${config.token})`);
});
