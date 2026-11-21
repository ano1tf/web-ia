import * as cheerio from 'cheerio';

/**
 * Normalisation du "snapshot" d'une page : ce que l'agent reçoit.
 * Format compact et stable, optimisé pour les tokens.
 *
 *   URL / TITRE
 *   TEXTE        (contenu lisible, sans nav/footer/pub)
 *   ÉLÉMENTS     ([ref] role "libellé" — c'est ce que l'agent cible)
 */

const DROP = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'link', 'meta',
  'nav', 'footer', 'aside', 'form[hidden]', '[aria-hidden="true"]',
  '.ad', '.ads', '.advert', '.cookie-banner', '#onetrust-banner-sdk',
];

export function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  const cut = head.lastIndexOf('\n');
  return { text: (cut > max * 0.6 ? head.slice(0, cut) : head) + '\n…[tronqué]', truncated: true };
}

/**
 * Fonction injectée dans la page (mode Chromium).
 * Elle marque les éléments interactifs avec data-webia-ref et renvoie
 * le texte visible + la liste des éléments.
 */
export function extractInPage() {
  const MAX_ELEMENTS = 120;
  const existing = document.querySelectorAll('[data-webia-ref]');
  existing.forEach((el) => el.removeAttribute('data-webia-ref'));

  const labelOf = (el) => {
    const direct =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute('placeholder') ||
      el.innerText ||
      el.value ||
      el.getAttribute('name') ||
      '';
    return String(direct).replace(/\s+/g, ' ').trim().slice(0, 90);
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };

  const selector =
    'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [contenteditable=true], [onclick]';
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (n >= MAX_ELEMENTS) break;
    if (!visible(el)) continue;
    if (el.disabled) continue;
    n += 1;
    const ref = `e${n}`;
    el.setAttribute('data-webia-ref', ref);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag);
    const kind =
      tag === 'input' || tag === 'textarea' || tag === 'select'
        ? type === 'checkbox' || type === 'radio'
          ? `case à cocher(${el.checked ? 'cochée' : 'vide'})`
          : `champ(${type || 'text'})${el.value ? ` valeur="${String(el.value).slice(0, 40)}"` : ''}`
        : role;
    elements.push({ ref, kind, label: labelOf(el), required: el.required || false });
  }

  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,iframe,canvas,nav,footer,aside,[aria-hidden="true"]').forEach((e) => e.remove());
  const text = (clone.innerText || clone.textContent || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return {
    title: document.title,
    url: location.href,
    text,
    elements,
    forms: document.querySelectorAll('form').length,
    hasPasswordField: !!document.querySelector('input[type=password]'),
    headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 15).map((h) => h.innerText.trim()).filter(Boolean),
  };
}

/** Même chose mais à partir du HTML brut (mode HTTP). */
export function htmlToSnapshot(html, url, { maxChars = 12000, maxElements = 80 } = {}) {
  const $ = cheerio.load(html);
  for (const sel of DROP) {
    try {
      $(sel).remove();
    } catch {
      /* sélecteur non supporté : ignore */
    }
  }

  const elements = [];
  const push = (el, kind, label) => {
    if (elements.length >= maxElements) return;
    const clean = cleanText(label).slice(0, 90);
    if (!clean && kind.startsWith('champ')) return;
    elements.push({ ref: `e${elements.length + 1}`, kind, label: clean });
  };

  $('input:not([type=hidden]), textarea, select').each((_, el) => {
    const $el = $(el);
    const type = $el.attr('type') || (el.tagName === 'textarea' ? 'textarea' : el.tagName === 'select' ? 'select' : 'text');
    const label =
      $el.attr('aria-label') ||
      (($el.attr('id') && $(`label[for="${$el.attr('id')}"]`).text()) || '') ||
      $el.attr('placeholder') ||
      $el.attr('name') ||
      '';
    const value = $el.attr('value') || $(el).text().slice(0, 40);
    push(el, `champ(${type})${value ? ` valeur="${cleanText(value).slice(0, 40)}"` : ''}`, label);
  });
  $('button, [role=button], input[type=submit], input[type=button]').each((_, el) => {
    const $el = $(el);
    push(el, 'bouton', $el.attr('aria-label') || $el.text() || $el.attr('value') || '');
  });
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const label = $el.attr('aria-label') || $el.text();
    if (cleanText(label)) push(el, 'lien', `${label} → ${$el.attr('href')}`);
  });

  const title = cleanText($('title').first().text());
  const bodyText = cleanText($('main').text() || $('article').text() || $('body').text());
  const { text, truncated } = truncate(bodyText, maxChars);

  return {
    title,
    url,
    text,
    elements,
    headings: $('h1,h2,h3')
      .slice(0, 15)
      .map((_, h) => cleanText($(h).text()))
      .get()
      .filter(Boolean),
    forms: $('form').length,
    hasPasswordField: $('input[type=password]').length > 0,
    truncated,
  };
}

/** Rendu texte du snapshot pour un LLM. */
export function renderSnapshot(snap) {
  const lines = [];
  lines.push(`URL: ${snap.url}`);
  lines.push(`TITRE: ${snap.title || '(sans titre)'}`);
  if (snap.hasPasswordField) lines.push('⚠️ Cette page contient un champ mot de passe : la connexion doit être faite par l’humain.');
  if (snap.headings?.length) lines.push(`SECTIONS: ${snap.headings.join(' | ')}`);
  lines.push('');
  lines.push('TEXTE:');
  lines.push(snap.text || '(vide)');
  if (snap.elements?.length) {
    lines.push('');
    lines.push('ÉLÉMENTS INTERACTIFS (refs utilisables avec click/fill):');
    for (const el of snap.elements) {
      lines.push(`[${el.ref}] ${el.kind} — « ${el.label || '(sans libellé)'} »${el.required ? ' *requis' : ''}`);
    }
  }
  return lines.join('\n');
}
