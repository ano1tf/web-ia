/**
 * Un pot à cookies minimaliste mais correct pour un navigateur serveur.
 * Il conserve les cookies par domaine/path et les rejoue vers l'origine cible
 * (et non vers notre propre domaine). C'est ce qui permet à l'humain de se
 * connecter "pour de vrai" sur un site et à l'IA de réutiliser la session.
 */

function defaultPath(pathname) {
  if (!pathname || !pathname.startsWith('/')) return '/';
  const idx = pathname.lastIndexOf('/');
  if (idx <= 0) return '/';
  return pathname.slice(0, idx);
}

function domainMatches(host, domain, hostOnly) {
  if (hostOnly) return host === domain;
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(reqPath, cookiePath) {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

function parseSetCookie(raw, url) {
  const parts = String(raw).split(';');
  const [pair, ...attrs] = parts;
  const eq = pair.indexOf('=');
  if (eq < 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  const host = String(url.hostname || '').toLowerCase();
  const cookie = {
    name,
    value,
    // Un hôte sans point (localhost) ne s'étend jamais à un sous-domaine.
    domain: host,
    hostOnly: true,
    path: defaultPath(url.pathname),
    expiresAt: null,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  };

  let maxAge = null;
  for (const attr of attrs) {
    const i = attr.indexOf('=');
    const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? '' : attr.slice(i + 1).trim();
    if (key === 'domain' && val) {
      cookie.domain = val.replace(/^\./, '').toLowerCase();
      cookie.hostOnly = false;
    } else if (key === 'path' && val.startsWith('/')) {
      cookie.path = val;
    } else if (key === 'max-age') {
      const n = Number(val);
      if (Number.isFinite(n)) maxAge = n;
    } else if (key === 'expires') {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) cookie.expiresAt = t;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'samesite') {
      cookie.sameSite = val || 'Lax';
    }
  }

  if (maxAge !== null) cookie.expiresAt = Date.now() + maxAge * 1000;

  // Sécurité : un domaine déclaré doit couvrir l'hôte qui l'a émis.
  if (!domainMatches(url.hostname.toLowerCase(), cookie.domain, cookie.hostOnly)) {
    cookie.domain = url.hostname.toLowerCase();
    cookie.hostOnly = true;
  }
  return cookie;
}

export class CookieJar {
  constructor() {
    /** @type {Map<string, object>} */
    this.cookies = new Map();
  }

  key(c) {
    return `${c.domain}|${c.path}|${c.name}`;
  }

  /** Enregistre les en-têtes set-cookie d'une réponse. */
  store(setCookieHeaders, url) {
    for (const raw of setCookieHeaders || []) {
      const cookie = parseSetCookie(raw, url);
      if (!cookie) continue;
      const k = this.key(cookie);
      const expired = cookie.expiresAt !== null && cookie.expiresAt <= Date.now();
      if (expired || cookie.value === '') {
        this.cookies.delete(k);
      } else {
        this.cookies.set(k, cookie);
      }
    }
  }

  /** Construit l'en-tête Cookie à envoyer à cette URL. */
  header(url) {
    const host = url.hostname.toLowerCase();
    const path = url.pathname || '/';
    const secureOk = url.protocol === 'https:';
    const out = [];
    for (const [k, c] of this.cookies) {
      if (c.expiresAt !== null && c.expiresAt <= Date.now()) {
        this.cookies.delete(k);
        continue;
      }
      if (c.secure && !secureOk) continue;
      if (!domainMatches(host, c.domain, c.hostOnly)) continue;
      if (!pathMatches(path, c.path)) continue;
      out.push(`${c.name}=${c.value}`);
    }
    // Les cookies au chemin le plus spécifique d'abord.
    return out.sort((a, b) => b.length - a.length).join('; ');
  }

  list() {
    return [...this.cookies.values()].map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expiresAt: c.expiresAt,
    }));
  }

  clear() {
    this.cookies.clear();
  }
}

export { parseSetCookie };
