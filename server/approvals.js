import crypto from 'node:crypto';
import { log } from './log.js';

/**
 * File d'attente d'approbations humaines pour les actions engageantes
 * (clic, soumission de formulaire, paiement...). L'IA dépose une demande,
 * l'humain valide dans la console, l'IA récupère la décision.
 */
const pending = new Map();
const decisions = new Map();

function keyOf(site, action) {
  return `${site}:${action}`;
}

export function createApproval({ site, action, summary, details }) {
  // Si l'humain a choisi "toujours autoriser pour ce site", on passe.
  const remembered = decisions.get(keyOf(site, action));
  if (remembered === 'always') {
    log('approval', `Action « ${action} » autorisée d'office sur ${site}`, { site, level: 'info' });
    return { approved: true, remembered: true };
  }

  const id = crypto.randomUUID();
  const req = { id, site, action, summary, details, at: new Date().toISOString(), status: 'pending' };
  pending.set(id, req);
  log('approval', `En attente de validation : ${summary}`, { site, approvalId: id, level: 'warn' });
  return { approved: false, pending: req };
}

export function listApprovals() {
  return [...pending.values()].filter((r) => r.status === 'pending');
}

export function resolveApproval(id, decision, { remember = false } = {}) {
  const req = pending.get(id);
  if (!req) return null;
  req.status = decision === 'approve' ? 'approved' : 'denied';
  req.decidedAt = new Date().toISOString();
  pending.delete(id);
  if (remember) decisions.set(keyOf(req.site, req.action), decision === 'approve' ? 'always' : 'never');
  log('approval', `${req.status === 'approved' ? 'Validé' : 'Refusé'} : ${req.summary}`, {
    site: req.site,
    level: req.status === 'approved' ? 'info' : 'warn',
  });
  return req;
}

export function isDeniedByDefault(site, action) {
  return decisions.get(keyOf(site, action)) === 'never';
}
