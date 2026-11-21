/**
 * Démo de bout en bout, sans agent externe : simule un agent qui utilise les
 * outils MCP contre le site de démonstration intégré.
 *
 *   npm start            (dans un autre terminal)
 *   npm run demo
 */
const BASE = process.env.WEBIA_URL || 'http://127.0.0.1:8787';
const SITE = '127.0.0.1';
const TOKEN = process.env.WEBIA_TOKEN || 'dev-token';

const api = async (path, body, method = 'POST') => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-webia-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
};

const tool = (name, args) => api(`/api/tools/${name}`, args);
const step = (n, t) => console.log(`\n\x1b[36m${n}. ${t}\x1b[0m`);
const show = (o) => console.log(JSON.stringify(o, null, 2).slice(0, 900));

(async () => {
  step(1, 'État du moteur');
  const health = await api('/api/health', null, 'GET');
  console.log('moteur :', health.engine.engine, '—', health.engine.reason);

  step(2, "L'IA ouvre la page de connexion");
  // Note : sur une instance déjà utilisée, la mémoire « Toujours autoriser » existe ;
  // le scénario reste valable, l'étape 5 est alors sautée explicitement.
  const page = await tool('browse_open', { url: `${BASE}/demo/login` });
  console.log('handoff/loginRequired :', page.loginRequired, '| site :', page.site);

  step(3, 'Politique « validation requise » sur le site de démo');
  await api(`/api/policies/${SITE}`, { level: 'confirm' }, 'PUT');
  await api(`/api/policies/${SITE}`, { level: 'confirm' }, 'PUT'); // ré-affirme (pas d'état « toujours » entre deux runs)

  step(4, "L'IA lit la page, puis remplit les champs (autorisé)");
  const snap = await tool('browse_snapshot', { site: SITE });
  console.log(snap.snapshot.split('\n').filter((l) => l.startsWith('[')).join('\n'));
  console.log(await tool('browse_fill', { site: SITE, ref: 'e1', value: 'demo@web-ia.test' }));
  console.log(await tool('browse_fill', { site: SITE, ref: 'e2', value: 'demo1234' }));

  step(5, "L'IA demande à soumettre → validation humaine requise");
  const click = await tool('browse_click', { site: SITE, ref: 'e3', submit: true });
  if (click.status === 'approval_required') {
    console.log('en attente :', click.pending.summary);
    await new Promise((r) => setTimeout(r, 800));
    const decided = await api(`/api/approvals/${click.pending.id}`, { decision: 'approve', remember: true });
    console.log('décision humaine :', decided.status);
  }

  step(5.5, "L'IA rejoue l'action autorisée : soumission réelle, session ouverte");
  const after = await tool('browse_click', { site: SITE, ref: 'e3', submit: true });
  console.log('page après soumission :', after.url || JSON.stringify(after).slice(0, 200));
  if (after.snapshot) console.log(after.snapshot.split('\n').slice(0, 5).join('\n'));
  const again = await tool('browse_snapshot', { site: SITE });
  console.log('session authentifiée réutilisable :', /Boîte de réception/.test(again.snapshot) ? 'OUI (cookies conservés)' : 'non');

  step(6, 'Journal d’activité');
  const { activity } = await api('/api/activity?limit=12', null, 'GET');
  for (const a of activity.slice(-10)) console.log(` ${a.at.slice(11, 19)} ${a.type.padEnd(9)} ${a.message}`);

  console.log('\n\x1b[32mDémo terminée.\x1b[0m Ouvre la console pour voir la session, le viewer et le journal.');
})().catch((e) => {
  console.error('\x1b[31mÉchec :\x1b[0m', e.message);
  process.exit(1);
});
