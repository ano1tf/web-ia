import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config } from '../config.js';
import { sanitizeUrl } from '../net.js';
import { extractInPage, renderSnapshot } from './snapshot.js';

/**
 * Moteur principal : vrai Chromium, profil persistant par site.
 * L'humain s'y connecte une fois via le viewer live ; l'IA réutilise
 * les cookies et le localStorage du même profil.
 */

let sharedBrowser = null;
let chromiumPromise = null;

async function resolveExecutable() {
  if (config.chromiumPath) return config.chromiumPath;
  if (process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.WEBIA_USE_PLAYWRIGHT) return undefined;
  try {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    const p = await sparticuz.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* pas de binaire packagé : on laisse playwright choisir */
  }
  return undefined;
}

export async function ensureBrowser() {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (chromiumPromise) return chromiumPromise;
  chromiumPromise = (async () => {
    const executablePath = await resolveExecutable();
    const args = [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ];
    const browser = await chromium.launch({
      executablePath,
      headless: config.headless,
      args,
      chromiumSandbox: false,
    });
    sharedBrowser = browser;
    return browser;
  })();
  try {
    return await chromiumPromise;
  } finally {
    chromiumPromise = null;
  }
}

export async function shutdownBrowser() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      /* ignore */
    }
    sharedBrowser = null;
  }
}

export class BrowserSession {
  kind = 'chromium';

  constructor(site, dir) {
    this.site = site;
    this.dir = dir;
    this.context = null;
    this.page = null;
    this.lastUsedAt = new Date().toISOString();
    this.viewers = new Set();
  }

  async start() {
    const browser = await ensureBrowser();
    this.context = await browser.newContext({
      viewport: config.viewport,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      storageState: this.loadState(), // cookies + localStorage du profil
      acceptDownloads: true,
    });
    this.context.setDefaultTimeout(30000);
    this.page = await this.context.newPage();

    this.page.on('framenavigated', (frame) => {
      if (frame === this.page.mainFrame()) this.touch();
    });

    // Le viewer live consomme les frames JPEG du screencast CDP.
    this.page.on('close', () => this.stopCast());

    await this.page.goto('about:blank');
  }

  loadState() {
    const file = path.join(this.dir, 'storage.json');
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  async persist() {
    try {
      if (!this.context) return;
      const state = await this.context.storageState();
      const file = path.join(this.dir, 'storage.json');
      fs.writeFileSync(file, JSON.stringify(state));
      fs.chmodSync(file, 0o600); // contient des cookies de session
    } catch {
      /* ignore */
    }
  }

  touch() {
    this.lastUsedAt = new Date().toISOString();
  }

  currentUrl() {
    try {
      return this.page?.url();
    } catch {
      return null;
    }
  }

  async currentTitle() {
    try {
      return await this.page?.title();
    } catch {
      return null;
    }
  }

  async loginHints() {
    const cookies = this.context ? await this.context.cookies().catch(() => []) : [];
    return [`${cookies.length} cookie(s)`, this.currentUrl() || 'aucune page'];
  }

  async open(url) {
    const target = sanitizeUrl(url);
    if (!target) throw new Error('URL invalide');
    this.touch();
    const res = await this.page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.persist();
    const snap = await this.snapshot();
    return { snapshot: snap, status: res ? res.status() : null };
  }

  async snapshot() {
    this.touch();
    const data = await this.page.evaluate(extractInPage);
    // Texte tronqué intelligemment par renderSnapshot côté appelant
    return data;
  }

  async fill(ref, value) {
    this.touch();
    const loc = this.page.locator(`[data-webia-ref="${ref}"]`);
    if (!(await loc.count())) throw new Error(`Élément ${ref} introuvable (refaire un snapshot)`);
    await loc.first().fill(String(value));
    await this.persist();
    return { filled: true, ref, value: String(value).slice(0, 80) };
  }

  async click(ref, { submit = false } = {}) {
    this.touch();
    const loc = this.page.locator(`[data-webia-ref="${ref}"]`);
    if (!(await loc.count())) throw new Error(`Élément ${ref} introuvable (refaire un snapshot)`);
    const el = loc.first();
    const [nav] = await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
      el.click({ timeout: 15000 }),
    ]);
    if (!nav && submit) {
      await this.page.waitForTimeout(1500);
    }
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.persist();
    return { clicked: true, ref, url: this.currentUrl(), navigated: !!nav };
  }

  async type(ref, text) {
    this.touch();
    const loc = this.page.locator(`[data-webia-ref="${ref}"]`).first();
    await loc.click();
    await loc.type(String(text), { delay: 25 });
    await this.persist();
    return { typed: true, ref };
  }

  async press(key) {
    await this.page.keyboard.press(key);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.persist();
    return { pressed: key, url: this.currentUrl() };
  }

  async screenshot({ fullPage = false } = {}) {
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 70, fullPage });
    return buf;
  }

  async links(limit = 40) {
    return this.page.evaluate((max) => {
      return [...document.querySelectorAll('a[href]')]
        .map((a) => ({ text: (a.innerText || '').trim().slice(0, 80), href: a.href }))
        .filter((l) => l.href.startsWith('http'))
        .slice(0, max);
    }, limit);
  }

  async evaluate(script) {
    return this.page.evaluate(script);
  }

  /** --- Screencast CDP : le "viewer live" pour que l'humain se connecte --- */
  async startCast(onFrame) {
    this.viewers.add(onFrame);
    if (this.cdp) return;
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      for (const fn of this.viewers) {
        try {
          fn(data, metadata);
        } catch {
          /* ignore */
        }
      }
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId });
      } catch {
        /* ignore */
      }
    });
    await this.cdp.send('Page.enable');
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
  }

  async stopCast(onFrame) {
    if (onFrame) this.viewers.delete(onFrame);
    if (this.viewers.size > 0 || !this.cdp) return;
    try {
      await this.cdp.send('Page.stopScreencast');
      await this.cdp.detach();
    } catch {
      /* ignore */
    }
    this.cdp = null;
  }

  /** --- Commandes souris/clavier pour le viewer humain --- */
  async input(action) {
    const { type, x, y, text, key, button = 'left' } = action;
    if (type === 'move') await this.page.mouse.move(x, y);
    else if (type === 'click') await this.page.mouse.click(x, y, { button });
    else if (type === 'wheel') await this.page.mouse.wheel(0, y || 300);
    else if (type === 'type') await this.page.keyboard.type(String(text || ''));
    else if (type === 'key') await this.page.keyboard.press(key || 'Enter');
    else if (type === 'scroll') await this.page.mouse.wheel(0, y || 300);
  }

  render(snap) {
    return renderSnapshot(snap);
  }

  async stop() {
    await this.persist();
    try {
      await this.context?.close();
    } catch {
      /* ignore */
    }
    this.context = null;
    this.page = null;
  }
}
