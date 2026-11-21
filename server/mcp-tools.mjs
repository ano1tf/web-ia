/**
 * Définitions des outils exposés à l'IA (format MCP `tools/list`).
 * Fichier volontairement sans dépendance : il est partagé entre le serveur
 * et le pont stdio (bin/webia-mcp.mjs).
 */
export const TOOLS = [
  {
    name: 'browse_open',
    description:
      "Ouvre une URL dans la session du site et renvoie un snapshot (texte lisible + éléments interactifs avec leurs refs). Si le site exige une connexion (SSO, redirection hors domaine), renvoie handoff=true avec l'URL : l'humain doit se connecter dans la console, puis rappeler session_status.",
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL absolue à ouvrir (https://...)' } },
      required: ['url'],
    },
  },
  {
    name: 'browse_snapshot',
    description: 'Renvoie le snapshot de la page courante du site (texte, titres, éléments interactifs et leurs refs).',
    inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] },
  },
  {
    name: 'browse_click',
    description:
      "Clique sur un élément repéré par sa ref (ex. e12). Sujet à la politique du site : en niveau « confirm », un clic de soumission attend une validation humaine dans la console.",
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string' },
        ref: { type: 'string', description: 'Ref issue du dernier snapshot' },
        submit: { type: 'boolean', description: 'true si ce clic soumet un formulaire ou engage une action' },
      },
      required: ['site', 'ref'],
    },
  },
  {
    name: 'browse_fill',
    description: 'Remplit un champ (input/textarea/select) repéré par sa ref.',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string' }, ref: { type: 'string' }, value: { type: 'string' } },
      required: ['site', 'ref', 'value'],
    },
  },
  {
    name: 'browse_links',
    description: 'Liste les liens de la page courante.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] },
  },
  {
    name: 'browse_screenshot',
    description: "Capture d'écran de la page courante (data URL JPEG, moteur Chromium uniquement).",
    inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] },
  },
  {
    name: 'session_request_login',
    description:
      "Demande à l'humain de se connecter sur un site. Ouvre la page de connexion dans le viewer live et bloque jusqu'à confirmation (max 5 min). L'agent ne voit jamais le mot de passe.",
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Domaine, ex. github.com' },
        loginUrl: { type: 'string', description: 'URL de la page de connexion' },
      },
      required: ['site'],
    },
  },
  {
    name: 'session_status',
    description: 'État du moteur et des sessions : sites ouverts, moteur (chromium/http), dernière activité.',
    inputSchema: { type: 'object', properties: {} },
  },
];
