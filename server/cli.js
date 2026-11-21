import { start } from './index.js';

start().catch((err) => {
  console.error('[web-ia] démarrage impossible :', err);
  process.exit(1);
});
