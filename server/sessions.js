import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { BrowserSession } from './browser/chromium.js';
import { HttpSession } from './browser/http.js';
import { log } from './log.js';

/**
 * Gestionnaire de sessions : une session = un profil persistant (cookies,
 * localStorage, logins) pour un "site". L'humain s'y connecte, l'IA réutilise.
 */
const sessions = new Map();
let engineInfo = null;

function profileDirFor(site) {
  const safe = site.replace(/[^a-z0-9.-]/gi, '_');
  return path.join(config.profilesDir, safe);
}

export async function detectEngine() {
  if (engineInfo) return engineInfo;
  if (config.engine === 'http') {
    engineInfo = { engine: 'http', reason: 'forcé par WEBIA_ENGINE=http' };
    return engineInfo;
  }
  try {
    const probe = new BrowserSession('__probe__');
    await probe.start();
    await probe.stop();
    engineInfo = { engine: 'chromium', reason: 'Chromium opérationnel' };
  } catch (err) {
    engineInfo = {
      engine: 'http',
      reason: `Chromium indisponible (${String(err.message).split('\n')[0].slice(0, 140)})`,
    };
  }
  log('engine', `Moteur : ${engineInfo.engine} — ${engineInfo.reason}`, {
    level: engineInfo.engine === 'chromium' ? 'info' : 'warn',
  });
  return engineInfo;
}

export async function getSession(site, { allowHttp = true } = {}) {
  const existing = sessions.get(site);
  if (existing) return existing;
  const info = await detectEngine();
  const dir = profileDirFor(site);
  fs.mkdirSync(dir, { recursive: true });

  let session;
  if (info.engine === 'chromium') {
    session = new BrowserSession(site, dir);
    try {
      await session.start();
    } catch (err) {
      if (!allowHttp) throw err;
      log('engine', `Bascule en mode HTTP pour ${site} : ${err.message.slice(0, 120)}`, { site, level: 'warn' });
      session = new HttpSession(site, dir);
    }
  } else {
    session = new HttpSession(site, dir);
  }
  session.lastUsedAt = new Date().toISOString();
  sessions.set(site, session);
  return session;
}

export function listSessions() {
  return [...sessions.entries()].map(([site, s]) => ({
    site,
    engine: s.kind,
    url: s.currentUrl?.() || null,
    title: s.currentTitle?.() || null,
    lastUsedAt: s.lastUsedAt,
    loggedInHints: s.loginHints?.() || [],
  }));
}

export async function closeSession(site) {
  const s = sessions.get(site);
  if (!s) return false;
  sessions.delete(site);
  await s.stop();
  log('session', `Session fermée pour ${site}`, { site });
  return true;
}

export async function closeAll() {
  for (const [, s] of sessions) {
    try {
      await s.stop();
    } catch {
      /* ignore */
    }
  }
  sessions.clear();
}

export function getRawSession(site) {
  return sessions.get(site) || null;
}
