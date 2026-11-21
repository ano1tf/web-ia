import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { config } from './config.js';
import { createRouter } from './api.js';
import { demoRouter } from './demo.js';
import { closeAll, detectEngine } from './sessions.js';
import { log } from './log.js';
import { attachViewer } from './viewer-ws.js';

export async function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Le viewer et la console sont servis depuis le même hôte (preview sandbox).
    res.setHeader('x-content-type-options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(createRouter());
  app.use('/demo', demoRouter());

  // Console web (build Vite si présent, sinon page d'attente)
  const dist = path.join(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/demo') || req.path.startsWith('/ws')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) =>
      res
        .status(200)
        .type('html')
        .send('<h1>web-ia</h1><p>La console n’est pas encore construite : lancez <code>npm run build</code> (ou <code>npm run dev</code>).</p>'),
    );
  }

  const server = http.createServer(app);

  attachViewer(server);

  return { app, server };
}

export async function start() {
  const { server } = await createServer();
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  const info = await detectEngine();
  log('engine', `web-ia démarré sur http://${config.host}:${config.port} (moteur ${info.engine})`);
  const shutdown = async () => {
    await closeAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}
