import fs from 'node:fs';
import { config, paths } from './config.js';

/** Bus d'activité : chaque action de l'IA est journalisée et poussée en SSE. */
const listeners = new Set();
let seq = 0;

export function onActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function log(type, message, meta = {}) {
  const entry = { id: ++seq, at: new Date().toISOString(), type, message, ...meta };
  try {
    fs.appendFileSync(paths.activity, JSON.stringify(entry) + '\n');
  } catch {
    /* le journal ne doit jamais casser une action */
  }
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* ignore */
    }
  }
  return entry;
}

/** Relit les N dernières entrées (pour l'UI au chargement). */
export function recent(limit = 100) {
  try {
    const lines = fs.readFileSync(paths.activity, 'utf8').trim().split('\n');
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function activityPath() {
  return paths.activity;
}

export { config };
