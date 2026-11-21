import express from 'express';
import crypto from 'node:crypto';

/**
 * Site de démonstration intégré : sert à prouver la mécanique de bout en bout
 * (connexion humaine → session → lecture → remplissage → action validée)
 * sans dépendre d'un site tiers.
 */
export function demoRouter() {
  const r = express.Router();
  const sessions = new Map();
  const USER = { email: 'demo@web-ia.test', password: 'demo1234' };

  const state = new Map(); // sid -> { notes, messages: [] }

  const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#111}
label{display:block;margin:12px 0 4px;font-size:13px;font-weight:600}
input,textarea{width:100%;padding:9px;border:1px solid #cfd4dc;border-radius:8px;font:inherit}
button{margin-top:16px;padding:10px 16px;border:0;border-radius:8px;background:#111;color:#fff;font:inherit;cursor:pointer}
.card{border:1px solid #e3e7ee;border-radius:12px;padding:16px;margin:12px 0}
.err{color:#b42318;font-size:13px}.muted{color:#667085;font-size:13px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e3e7ee;padding-bottom:12px}
a{color:#175cd3}</style></head><body>${body}</body></html>`;

  function currentSid(req) {
    const raw = req.headers.cookie || '';
    const m = raw.match(/demo_sid=([^;]+)/);
    return m?.[1] || null;
  }

  r.get('/', (req, res) => {
    const sid = currentSid(req);
    if (!sid || !sessions.has(sid)) return res.redirect('/demo/login');
    const s = sessions.get(sid);
    const st = state.get(sid) || { notes: '', messages: [] };
    res.send(
      page(
        'Acme Mail — Boîte de réception',
        `<header><strong>Acme Mail</strong><span class="muted">${s.email}</span></header>
        <h1>Boîte de réception</h1>
        ${st.messages.length ? st.messages.map((m) => `<div class="card"><strong>${m.subject}</strong><div class="muted">de ${m.from}</div><p>${m.body}</p></div>`).join('') : '<p class="muted">Aucun message.</p>'}
        <h2>Réglages du profil</h2>
        <form method="post" action="/demo/notes">
          <label for="display_name">Nom affiché</label>
          <input id="display_name" name="display_name" value="${escapeHtml(st.notes)}" placeholder="Votre nom">
          <label for="signature">Signature</label>
          <textarea id="signature" name="signature" rows="3" placeholder="Cordialement…"></textarea>
          <button type="submit">Enregistrer</button>
        </form>
        <p><a href="/demo/logout">Se déconnecter</a></p>`,
      ),
    );
  });

  r.get('/login', (req, res) => {
    res.send(
      page(
        'Acme Mail — Connexion',
        `<h1>Connexion</h1>
        <p class="muted">Site de démonstration (compte : demo@web-ia.test / demo1234).</p>
        ${req.query.error ? '<p class="err">Identifiants invalides.</p>' : ''}
        <form method="post" action="/demo/login">
          <label for="email">Adresse e-mail</label>
          <input id="email" name="email" type="email" required autocomplete="username">
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" required autocomplete="current-password">
          <button type="submit">Se connecter</button>
        </form>`,
      ),
    );
  });

  r.use(express.urlencoded({ extended: false }));

  r.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    if (email === USER.email && password === USER.password) {
      const sid = crypto.randomUUID();
      sessions.set(sid, { email });
      state.set(sid, { notes: 'Compte de démonstration', messages: [
        { from: 'facturation@acme.test', subject: 'Votre facture de novembre', body: 'Montant : 42,00 €. Échéance le 30/11.' },
        { from: 'support@acme.test', subject: 'Bienvenue', body: 'Votre espace est prêt. Pensez à renseigner votre signature.' },
      ] });
      res.setHeader('set-cookie', `demo_sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
      return res.redirect('/demo/');
    }
    return res.redirect('/demo/login?error=1');
  });

  r.post('/notes', (req, res) => {
    const sid = currentSid(req);
    if (!sid || !sessions.has(sid)) return res.redirect('/demo/login');
    const st = state.get(sid);
    st.notes = String(req.body?.display_name || '').slice(0, 200);
    res.redirect('/demo/');
  });

  r.get('/logout', (req, res) => {
    const sid = currentSid(req);
    if (sid) {
      sessions.delete(sid);
      state.delete(sid);
    }
    res.setHeader('set-cookie', 'demo_sid=; Path=/; Max-Age=0');
    res.redirect('/demo/login');
  });

  return r;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
