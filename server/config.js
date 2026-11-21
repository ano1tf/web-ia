import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.WEBIA_DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(path.join(DATA_DIR, 'profiles'), { recursive: true });

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  dataDir: DATA_DIR,
  profilesDir: path.join(DATA_DIR, 'profiles'),
  /** Jeton qui protège l'API et le endpoint MCP HTTP. */
  token: process.env.WEBIA_TOKEN || 'dev-token-change-me',
  /** Chemin d'un Chromium/Chrome explicite. */
  chromiumPath: process.env.WEBIA_CHROMIUM || '',
  /** 'auto' | 'chromium' | 'http' — 'http' force le moteur sans navigateur. */
  engine: process.env.WEBIA_ENGINE || 'auto',
  headless: process.env.WEBIA_HEADLESS !== '0',
  viewport: { width: 1280, height: 800 },
  /** Taille max du texte de page envoyé à l'agent. */
  maxSnapshotChars: Number(process.env.WEBIA_MAX_SNAPSHOT || 12000),
};

export const paths = {
  policies: path.join(DATA_DIR, 'policies.json'),
  activity: path.join(DATA_DIR, 'activity.jsonl'),
};
