import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.js';
import { callTool, resolveLoginRequest } from './actions.js';
import { TOOLS } from './mcp-tools.mjs';
import { listApprovals, resolveApproval } from './approvals.js';
import { listPolicies, setPolicy, getPolicy, removePolicy } from './policies.js';
import { listSessions, closeSession, detectEngine } from './sessions.js';
import { onActivity, recent, log } from './log.js';
import { mcpManifest, handleJsonRpc } from './mcp.js';

export function createRouter() {
  const r = express.Router();

  // --- Auth par jeton (sauf health, qui ne révèle rien) ---
  function authOk(req) {
    const given = req.get('x-webia-token') || req.query.token || req.body?.token;
    if (!given) return false;
    const a = Buffer.from(String(given));
    const b = Buffer.from(config.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  r.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/mcp') return next();
    if (!authOk(req)) return res.status(401).json({ error: 'jeton invalide' });
    next();
  });

  r.get('/api/health', async (_req, res) => {
    const engine = await detectEngine();
    res.json({ ok: true, engine, version: '0.1.0' });
  });

  r.get('/api/sessions', async (_req, res) => {
    const sessions = await listSessions();
    res.json({
      sessions: sessions.map((s) => ({ ...s, policy: getPolicy(s.site) })),
    });
  });
  r.post('/api/sessions/:site/close', async (req, res) => {
    res.json({ closed: await closeSession(req.params.site) });
  });
  r.post('/api/sessions/:site/login-done', async (req, res) => {
    resolveLoginRequest(req.params.site, true);
    log('login', `Connexion confirmée par l'humain : ${req.params.site}`, { site: req.params.site });
    res.json({ ok: true });
  });

  r.get('/api/policies', (_req, res) => res.json(listPolicies()));
  r.put('/api/policies/:site', (req, res) => {
    try {
      res.json(setPolicy(req.params.site, req.body.level, req.body.note || ''));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  r.delete('/api/policies/:site', (req, res) => {
    removePolicy(req.params.site);
    res.json({ ok: true });
  });

  r.get('/api/approvals', (_req, res) => res.json({ approvals: listApprovals() }));
  r.post('/api/approvals/:id', (req, res) => {
    const out = resolveApproval(req.params.id, req.body.decision, { remember: !!req.body.remember });
    if (!out) return res.status(404).json({ error: 'demande inconnue' });
    res.json(out);
  });

  r.get('/api/activity', (req, res) => res.json({ activity: recent(Number(req.query.limit || 100)) }));

  // Flux temps réel pour la console (activité + sessions)
  r.get('/api/events', (req, res) => {
    if (!authOk(req)) return res.status(401).end();
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const off = onActivity((entry) => res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      off();
    });
  });

  r.get('/api/tools', (_req, res) => res.json({ tools: TOOLS }));

  r.post('/api/tools/:name', async (req, res) => {
    try {
      const out = await callTool(req.params.name, req.body || {});
      res.json(out);
    } catch (e) {
      log('error', `Échec ${req.params.name}: ${e.message}`, { level: 'error' });
      res.status(400).json({ error: e.message });
    }
  });

  // --- MCP ---
  r.get('/api/mcp', (_req, res) => res.json(mcpManifest()));
  r.post('/api/mcp', async (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'jeton invalide' });
    const out = await handleJsonRpc(req.body);
    if (out === null) return res.status(202).end(); // notification
    res.json(out);
  });

  return r;
}
