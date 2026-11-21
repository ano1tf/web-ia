# web-ia

Un **navigateur pour IA** : l'humain se connecte aux sites dans une console, l'agent IA agit ensuite dans **la même session** — via MCP (Claude Desktop, Cursor, agent maison) ou l'API HTTP.

> Le point clé : les mots de passe, la 2FA et les captchas restent entre les mains de l'humain. L'IA ne reçoit jamais que du texte extrait et des « refs » d'éléments.

---

## Ce qui marche

- **Sessions persistantes par site** : cookies + localStorage du profil sont conservés entre les runs.
- **Viewer live** : l'écran du Chromium distant est streamé (CDP screencast) dans la console ; tu cliques et tapes dedans. C'est ton login, pas celui de l'IA.
- **Moteur Chromium** (vrai navigateur, sites en JS) avec **repli automatique en moteur HTTP** (fetch + jar de cookies) quand Chromium ne peut pas démarrer.
- **8 outils IA** : `browse_open`, `browse_snapshot`, `browse_click`, `browse_fill`, `browse_links`, `browse_screenshot`, `session_request_login`, `session_status`.
- **Politique par site** : `lecture seule` / `validation requise` / `autonome`, appliquée côté serveur (pas côté prompt).
- **Approbations humaines** : les clics de soumission attendent une validation dans la console (bouton « Toujours » pour ne plus demander).
- **Journal d'audit** + flux SSE temps réel de tout ce que fait l'IA.
- **Garde anti-injection de prompt** : le contenu d'une page est une donnée, jamais une instruction ; les tentatives sont signalées dans le snapshot.
- **Site de démo intégré** (`/demo`) pour tester la boucle complète sans dépendre d'un tiers.
- **Zéro dépendance lourde** : Express, playwright-core, ws, cheerio. MCP implémenté à la main (stdio + HTTP).

## Démarrage

```bash
npm install
npm run build          # construit la console
WEBIA_TOKEN=un-secret npm start
# → http://localhost:8787
```

En développement (HMR) :

```bash
WEBIA_TOKEN=un-secret npm run dev   # http://localhost:5173
```

### Chromium

Le moteur navigateur nécessite un Chromium et ses bibliothèques système (`libnss3`, `libnspr4`, polices…).

```bash
# Option A : le Chromium packagé (téléchargé via npm, aucune lib système à installer)
# déjà en dépendance : @sparticuz/chromium — utilisé automatiquement.
# Option B : un Chrome/Chromium existant
WEBIA_CHROMIUM=/usr/bin/chromium npm start
# Option C : build Playwright classique
PLAYWRIGHT_BROWSERS_PATH=0 WEBIA_USE_PLAYWRIGHT=1 npx playwright-core install chromium
```

Sans Chromium, l'app **ne casse pas** : elle bascule sur le moteur HTTP (sites server-rendered, back-offices, mails HTML, docs).

## Brancher un agent

### Claude Desktop / Cursor (stdio)

Ajoute dans la config MCP du client :

```json
{
  "mcpServers": {
    "web-ia": {
      "command": "node",
      "args": ["/chemin/absolu/vers/web-ia/bin/webia-mcp.mjs"],
      "env": { "WEBIA_URL": "http://127.0.0.1:8787", "WEBIA_TOKEN": "un-secret" }
    }
  }
}
```

Le pont stdio relaie vers l'API locale : `npm start` doit tourner.

### Agent distant (HTTP)

```bash
curl -s localhost:8787/api/mcp \
  -H 'content-type: application/json' -H 'x-webia-token: un-secret' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

`GET /api/mcp` renvoie un manifeste (endpoint, auth, outils). Expose-le derrière un tunnel HTTPS si l'agent est externe — **jamais sans jeton**.

## Flux typique

1. `browse_open https://site.com` → `handoff: true` (SSO ou page de connexion).
2. La console affiche « Connexion humaine requise » ; tu te connectes dans le viewer.
3. Tu cliques **« J'ai terminé de me connecter »** → `session_request_login` se débloque.
4. L'agent refait `browse_snapshot` et agit : `browse_fill`, `browse_click`.
5. Si la politique est `validation requise`, l'action atterrit dans **Validations** : tu autorises (ou « Toujours »).

## Modèle de sécurité

| Risque | Réponse |
| --- | --- |
| L'IA lit un mot de passe | Champs password jamais exposés ; login réservé à l'humain |
| L'IA paie / supprime / envoie | Niveaux de politique par site + approbations + journal |
| Prompt injection dans une page | `guard.js` : détection, avertissement explicite dans le snapshot |
| Profil volé sur disque | `storage.json` / `cookies.json` en `chmod 600`, répertoire `data/` ignoré par Git |
| API ouverte sur le réseau | Jeton obligatoire (`x-webia-token`), WebSocket protégé aussi |

Ce que ce projet **ne** fait pas : stocker des mots de passe, contourner des captchas, ni utiliser un profil sans que l'humain l'ait ouvert.

## Structure

```
server/
  index.js        serveur HTTP + static + WebSocket
  api.js          routes REST (jeton obligatoire) + endpoint MCP
  mcp.js          JSON-RPC MCP (HTTP)
  mcp-tools.mjs   définitions des outils (partagées avec le pont stdio)
  actions.js      couche d'outils : politique, approbations, journal
  sessions.js     gestion des sessions (profil par site, choix du moteur)
  browser/
    chromium.js   Playwright + screencast CDP + profil persistant
    http.js       moteur de secours (fetch + jar)
    snapshot.js   extraction texte + éléments interactifs (refs e1, e2…)
  cookies.js      jar de cookies
  net.js          requêtes sortantes, détection de sortie de site (SSO)
  guard.js        anti-injection de prompt
  policies.js     politiques par site
  approvals.js    file de validations humaines
  viewer-ws.js    viewer live (frames + entrées)
  demo.js         site de démonstration
bin/webia-mcp.mjs pont MCP stdio
src/              console React (sessions, viewer, validations, activité)
```

## Limites connues

- Le screencast CDP n'émet que sur changement : la première frame est forcée par un mouvement de souris.
- Le moteur HTTP ne peut pas cliquer dans un DOM vivant (pas de JS) : il prépare un formulaire et le soumet.
- Pas encore de multi-utilisateurs : un jeton = une instance = un jeu de profils.
