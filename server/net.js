/** Requêtes HTTP sortantes avec jar de cookies et redirections maîtrisées. */

const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cookie',
  'content-length',
]);

export function sanitizeUrl(input, base) {
  try {
    const url = new URL(input, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

/** Un "site" = schéma + domaine enregistrable approximatif (eTLD+1 simplifié). */
export function siteOf(url) {
  const host = url.hostname.toLowerCase();
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // TLD à deux niveaux (co.uk, com.au, ...) : on garde trois labels.
  const twoLevel = /^(co|com|net|org|gov|edu|ac|or|ne|gouv|asso)\.[a-z]{2,3}$/;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIp) return host;
  if (parts.length >= 3 && twoLevel.test(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function isCrossSite(from, to) {
  if (!from || !to) return false;
  return siteOf(from) !== siteOf(to);
}

/**
 * Effectue une requête en suivant manuellement les redirections.
 * S'arrête (et renvoie hop.crossSite = true) dès qu'une redirection sort du site
 * courant : c'est le signal qu'une connexion SSO doit être faite par l'humain.
 */
export async function browserFetch(url, options = {}) {
  const {
    method: initialMethod = 'GET',
    headers = {},
    body: initialBody,
    jar,
    maxRedirects = 10,
    stopOnCrossSite = true,
    timeout = 45000,
    origin,
  } = options;

  const outgoing = { ...headers };
  let method = initialMethod;
  let body = initialBody;
  let current = url;
  const chain = [];

  for (let i = 0; i <= maxRedirects; i++) {
    // Un jar vide ne doit pas être "rempli" par les cookies de notre propre
    // service quand l'URL cible est le site de démo local.
    const cookie = jar ? jar.header(current) : '';
    const send = new Headers();
    for (const [k, v] of Object.entries(outgoing)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v != null) send.set(k, String(v));
    }
    if (!send.has('user-agent')) send.set('user-agent', DEFAULT_UA);
    if (!send.has('accept-language')) send.set('accept-language', 'fr-FR,fr;q=0.9,en;q=0.8');
    if (cookie) send.set('cookie', cookie);
    if (origin && !send.has('origin')) {
      send.set('origin', origin);
      send.set('referer', current.href);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetch(current.href, {
        method,
        headers: send,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: controller.signal,
        decompress: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (jar) {
      const setCookies =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : res.headers.raw
            ? res.headers.raw()['set-cookie'] || []
            : [];
      jar.store(setCookies, current);
    }

    const location = res.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(res.status) && location) {
      const next = sanitizeUrl(location, current);
      chain.push({ status: res.status, from: current.href, to: next?.href });
      // On draine le corps pour libérer la socket.
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore */
      }
      if (!next) return { response: res, url: current, chain, error: 'redirection invalide' };
      if (stopOnCrossSite && isCrossSite(current, next)) {
        return { response: null, url: next, chain, crossSite: true, needsHandoff: true };
      }
      // Comme les navigateurs : un POST redirigé en 301/302/303 devient un GET.
      if ([301, 302, 303].includes(res.status) && method !== 'GET' && method !== 'HEAD') {
        method = 'GET';
        body = undefined;
        for (const k of ['content-type', 'content-length']) delete outgoing[k];
      }
      current = next;
      continue;
    }

    return { response: res, url: current, chain };
  }

  throw new Error('Trop de redirections');
}
