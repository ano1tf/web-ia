import { siteOf, sanitizeUrl } from './net.js';
import { getSession } from './sessions.js';
import { getPolicy, can } from './policies.js';
import { createApproval, isDeniedByDefault } from './approvals.js';
import { log } from './log.js';
import { renderSnapshot } from './browser/snapshot.js';
import { config } from './config.js';
import { guardPageContent } from './guard.js';
import { TOOLS } from './mcp-tools.mjs';

export { TOOLS };

/**
 * Couche d'outils : c'est ici que l'IA passe. Chaque action vérifie la
 * politique du site, journalise, et passe par une approbation humaine
 * quand c'est une action engageante.
 */

function siteFor(url) {
  const u = sanitizeUrl(url);
  if (!u) throw new Error('URL invalide');
  return { url: u, site: siteOf(u) };
}

function requireAllowed(site, action, details) {
  const policy = getPolicy(site);
  if (policy.level === 'full') return { policy };
  if (can(policy.level, action)) return { policy };
  if (isDeniedByDefault(site, action)) {
    log('blocked', `Action « ${action} » refusée de façon permanente sur ${site}`, { site, level: 'warn' });
    throw new Error(`Action « ${action} » refusée par l'humain sur ${site}.`);
  }
  const approval = createApproval({ site, action, summary: details.summary, details });
  // « Toujours autoriser » : l'action passe, sans repasser par la file.
  if (approval.approved) return { policy, approved: true };
  return { policy, approval };
}

/** Attentes de connexion humaine, résolues par la console. */
const loginWaiters = new Map();
export function resolveLoginRequest(site, ok = true) {
  const w = loginWaiters.get(site);
  if (w) {
    loginWaiters.delete(site);
    w(ok);
  }
}

function waitForLogin(site, timeoutMs = 300000) {
  return new Promise((resolve) => {
    loginWaiters.set(site, resolve);
    setTimeout(() => {
      if (loginWaiters.has(site)) {
        loginWaiters.delete(site);
        resolve(false);
      }
    }, timeoutMs).unref?.();
  });
}

export async function callTool(name, args = {}) {
  switch (name) {
    case 'browse_open':
      return open(args);
    case 'browse_snapshot':
      return snapshot(args.site);
    case 'browse_click':
      return click(args);
    case 'browse_fill':
      return fill(args);
    case 'browse_links':
      return links(args.site);
    case 'browse_screenshot':
      return screenshot(args.site);
    case 'session_request_login':
      return requestLogin(args);
    case 'session_status':
      return status();
    default:
      throw new Error(`Outil inconnu: ${name}`);
  }
}

async function open({ url }) {
  const { url: u, site } = siteFor(url);
  log('open', `Ouverture de ${u.href}`, { site });
  const session = await getSession(site);
  const res = await session.open(u.href);

  if (res.handoff) {
    log('handoff', `Connexion humaine requise sur ${site}`, { site, level: 'warn' });
    return {
      handoff: true,
      site,
      loginUrl: res.loginUrl,
      message:
        "Une connexion humaine est nécessaire (redirection hors du site ou SSO). Demande à l'humain de se connecter dans la console, puis rappelle session_status.",
    };
  }

  const snap = await snapshotOf(session);
  const payload = {
    site,
    engine: session.kind,
    url: snap.url,
    snapshot: renderSnapshot(snap).slice(0, config.maxSnapshotChars),
    elements: snap.elements?.length || 0,
    loginRequired: isLoginPage(snap),
  };
  const guard = guardPageContent(snap, { site });
  if (guard.warning) payload.security_warning = guard.warning;
  return payload;
}

function isLoginPage(snap) {
  return !!snap?.hasPasswordField;
}

async function snapshotOf(session) {
  const snap = await session.snapshot();
  if (snap.text && snap.text.length > config.maxSnapshotChars * 3) {
    snap.text = snap.text.slice(0, config.maxSnapshotChars * 3);
  }
  return snap;
}

async function snapshot(site) {
  const session = await getSession(site);
  if (!session.currentUrl()) throw new Error(`Aucune page ouverte pour ${site}`);
  const snap = await snapshotOf(session);
  return { site, url: snap.url, snapshot: renderSnapshot(snap).slice(0, config.maxSnapshotChars) };
}

async function click({ site, ref, submit }) {
  if (!ref || !/^e\d+$/.test(ref)) throw new Error('ref invalide (attendu: e1, e2, ...)');
  const decision = requireAllowed(site, 'click', {
    summary: `Cliquer sur ${ref}${submit ? ' (soumission)' : ''} sur ${site}`,
    ref,
  });
  if (decision.approval) return { status: 'approval_required', ...decision.approval };
  const session = await getSession(site);
  try {
    const res = await session.click(ref, { submit: !!submit });
    log('click', `Clic sur ${ref} → ${res.url || site}`, { site });
    const snap = await snapshotOf(session);
    return { site, url: snap.url, snapshot: renderSnapshot(snap).slice(0, config.maxSnapshotChars) };
  } catch (err) {
    if (session.kind === 'chromium' && /submit/i.test(err.message)) throw err;
    throw err;
  }
}

async function fill({ site, ref, value }) {
  const decision = requireAllowed(site, 'fill', {
    summary: `Remplir ${ref} sur ${site}`,
    ref,
    valuePreview: String(value).slice(0, 40),
  });
  if (decision.approval) return { status: 'approval_required', ...decision.approval };
  const session = await getSession(site);
  const res = await session.fill(ref, value);
  log('fill', `Champ ${ref} rempli sur ${site}`, { site, valuePreview: res.value });
  return { site, ...res };
}

async function links(site) {
  const session = await getSession(site);
  const raw = await session.links?.(60);
  if (raw) return { site, links: raw };
  // Moteur HTTP : extraire depuis le snapshot
  const snap = await snapshotOf(session);
  return { site, links: snap.elements.filter((e) => e.kind === 'lien').slice(0, 60) };
}

async function screenshot(site) {
  const session = await getSession(site);
  const buf = await session.screenshot?.();
  if (!buf) throw new Error('Capture indisponible avec le moteur HTTP');
  return { site, image: `data:image/jpeg;base64,${buf.toString('base64')}` };
}

async function requestLogin({ site, loginUrl }) {
  if (!site) throw new Error('site requis');
  log('login-request', `Connexion demandée pour ${site}`, { site, level: 'warn' });
  const session = await getSession(site);
  if (loginUrl) {
    try {
      await session.open(loginUrl);
    } catch {
      /* la page de connexion peut échouer, l'humain navigue lui-même */
    }
  }
  const ok = await waitForLogin(site);
  return ok
    ? { loggedIn: true, site, message: "L'humain a signalé la connexion comme terminée. Refais browse_open ou browse_snapshot." }
    : { loggedIn: false, site, message: "Aucune confirmation de connexion (délai dépassé)." };
}

async function status() {
  const { listSessions } = await import('./sessions.js');
  const { detectEngine } = await import('./sessions.js');
  const info = await detectEngine();
  return { engine: info, sessions: await Promise.all(listSessions()) };
}
