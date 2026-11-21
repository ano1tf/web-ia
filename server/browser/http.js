import { browserFetch, sanitizeUrl, siteOf } from '../net.js';
import { CookieJar } from '../cookies.js';
import { htmlToSnapshot, renderSnapshot } from './snapshot.js';
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

/**
 * Moteur de secours sans navigateur : fetch + jar de cookies persistant.
 * Suffisant pour les sites server-rendered, les back-offices, la doc, les mails HTML.
 */
export class HttpSession {
  kind = 'http';

  constructor(site, dir) {
    this.site = site;
    this.dir = dir;
    this.jarFile = path.join(dir, 'cookies.json');
    this.jar = new CookieJar();
    this.url = null;
    this.title = null;
    this.lastHtml = '';
    this.lastUsedAt = new Date().toISOString();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.jarFile, 'utf8'));
      for (const c of raw) this.jar.cookies.set(`${c.domain}|${c.path}|${c.name}`, c);
    } catch {
      /* premier lancement */
    }
  }

  persist() {
    try {
      fs.writeFileSync(this.jarFile, JSON.stringify([...this.jar.cookies.values()], null, 2));
      fs.chmodSync(this.jarFile, 0o600);
    } catch {
      /* ignore */
    }
  }

  async start() {
    /* rien à démarrer */
  }

  async stop() {
    this.persist();
  }

  currentUrl() {
    return this.url;
  }

  currentTitle() {
    return this.title;
  }

  loginHints() {
    if (!this.url) return ['aucune page visitée'];
    return this.jar.list().length ? [`${this.jar.list().length} cookie(s) enregistré(s)`] : ['aucun cookie'];
  }

  async open(url) {
    const target = sanitizeUrl(url);
    if (!target) throw new Error('URL invalide');
    const res = await browserFetch(target, { jar: this.jar, origin: target.origin });
    if (res.needsHandoff) {
      this.url = res.url.href;
      this.persist();
      return { handoff: true, loginUrl: res.url.href, chain: res.chain };
    }
    const html = await res.response.text();
    this.lastHtml = html;
    this.url = res.url.href;
    const snap = htmlToSnapshot(html, this.url);
    this.title = snap.title;
    this.persist();
    return { snapshot: snap, status: res.response.status };
  }

  async snapshot() {
    if (!this.lastHtml) throw new Error('Aucune page ouverte. Utilisez open() d’abord.');
    return htmlToSnapshot(this.lastHtml, this.url);
  }

  /** Retrouve le nom réel du champ à partir de sa ref (e1, e2…) dans le HTML courant. */
  fieldNameFor(ref) {
    const idx = Number(String(ref).replace(/[^0-9]/g, '')) - 1;
    if (!Number.isInteger(idx) || idx < 0) return null;
    const $ = cheerio.load(this.lastHtml || '');
    const fields = $('input:not([type=hidden])')
      .map((i, el) => ({ tag: 'input', name: $(el).attr('name'), type: $(el).attr('type') || 'text' }))
      .get()
      .concat($('textarea').map((i, el) => ({ tag: 'textarea', name: $(el).attr('name') })).get())
      .concat($('select').map((i, el) => ({ tag: 'select', name: $(el).attr('name') })).get());
    const field = fields[idx];
    if (!field?.name) return null;
    return field;
  }

  async fill(ref, value) {
    // Pas de DOM vivant en mode HTTP : on prépare la paire champ=valeur,
    // que submit() enverra au serveur.
    const field = this.fieldNameFor(ref);
    if (!field) throw new Error(`Champ ${ref} introuvable (refaire un snapshot)`);
    this.pendingForm = { ...(this.pendingForm || {}), [field.name]: String(value) };
    return { queued: true, field: field.name, note: 'Valeur enregistrée ; utilisez click avec submit=true pour envoyer.' };
  }

  async click(selectorOrRef, { submit = false } = {}) {
    if (submit) return this.submit();
    throw new Error('Le moteur HTTP ne peut pas cliquer. Ouvrez l’URL cible directement avec open().');
  }

  async submit() {
    if (!this.pendingForm || !this.lastHtml) throw new Error('Aucun formulaire rempli.');
    const $ = cheerio.load(this.lastHtml);
    const form = $('form').first();
    const actionAttr = form.attr('action');
    const action = actionAttr ? sanitizeUrl(actionAttr, this.url) : sanitizeUrl(this.url);
    const method = (form.attr('method') || 'get').toLowerCase();
    const body = new URLSearchParams(this.pendingForm);

    if (method === 'get') {
      const target = sanitizeUrl(`${action.href}?${body.toString()}`);
      return this.open(target.href);
    }

    const res = await browserFetch(action, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      jar: this.jar,
      origin: action.origin,
    });
    if (res.needsHandoff) return { handoff: true, loginUrl: res.url.href };
    const html = await res.response.text();
    this.lastHtml = html;
    this.url = res.url.href;
    const snap = htmlToSnapshot(html, this.url);
    this.title = snap.title;
    this.pendingForm = null;
    this.persist();
    return { snapshot: snap, status: res.response.status };
  }

  async screenshot() {
    return null;
  }

  render(snap) {
    return renderSnapshot(snap);
  }
}

export { siteOf };
