import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { getRawSession } from './sessions.js';
import { log } from './log.js';

/**
 * Viewer live : frames JPEG du screencast CDP vers la console,
 * et événements souris/clavier de l'humain vers la page.
 */
export function attachViewer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://placeholder');
    if (!url.pathname.startsWith('/ws/viewer')) return socket.destroy();
    if (url.searchParams.get('token') !== config.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, url));
  });

  wss.on('connection', async (ws, url) => {
    const site = url.searchParams.get('site');
    const session = getRawSession(site);
    if (!session || session.kind !== 'chromium') {
      ws.send(JSON.stringify({ type: 'error', message: `Aucune session Chromium ouverte pour ${site}. Moteur actif : ${session?.kind || 'aucun'}.` }));
      return ws.close();
    }

    const onFrame = (data, metadata) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'frame', data, w: metadata?.deviceWidth, h: metadata?.deviceHeight }));
      }
    };

    try {
      await session.startCast(onFrame);
      ws.send(JSON.stringify({ type: 'ready', site, url: session.currentUrl() }));
      // Force une première frame (le screencast n'émet que sur changement).
      await session.input({ type: 'move', x: 2, y: 2 }).catch(() => {});
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      return ws.close();
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') await session.input(msg.event);
        else if (msg.type === 'navigate') await session.open(msg.url);
        else if (msg.type === 'done') {
          await session.persist?.();
          log('login', `Session prête pour ${site}`, { site });
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => session.stopCast(onFrame));
  });

  return wss;
}
