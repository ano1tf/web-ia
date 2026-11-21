import fs from 'node:fs';
import { paths } from './config.js';

/**
 * Politiques par site. Un "site" est un domaine enregistrable (ex. github.com).
 * - readonly : l'IA peut ouvrir et lire, jamais cliquer ni remplir.
 * - confirm  : l'IA peut remplir, mais toute soumission attend une validation humaine.
 * - full     : l'IA agit librement (le site reste listé, audité, révocable).
 */
export const LEVELS = ['readonly', 'confirm', 'full'];
const DEFAULT_LEVEL = 'confirm';

function read() {
  try {
    return JSON.parse(fs.readFileSync(paths.policies, 'utf8'));
  } catch {
    return { sites: {}, updatedAt: null };
  }
}

function write(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(paths.policies, JSON.stringify(data, null, 2));
  return data;
}

export function listPolicies() {
  return read();
}

export function getPolicy(site) {
  const data = read();
  return { site, level: data.sites[site]?.level || DEFAULT_LEVEL, note: data.sites[site]?.note || '' };
}

export function setPolicy(site, level, note = '') {
  if (!LEVELS.includes(level)) throw new Error(`niveau invalide: ${level}`);
  const data = read();
  data.sites[site] = { level, note, updatedAt: new Date().toISOString() };
  write(data);
  return getPolicy(site);
}

export function removePolicy(site) {
  const data = read();
  delete data.sites[site];
  write(data);
}

export function can(level, action) {
  if (level === 'full') return true;
  if (level === 'readonly') return action === 'read';
  // confirm
  if (action === 'read' || action === 'fill') return true;
  return false; // click/submit nécessite une approbation
}
