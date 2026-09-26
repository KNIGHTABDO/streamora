// Loaded by main.js after the first render. Each piece no-ops when it isn't configured.
import { initSync } from './sync.js';
import { initTrakt } from './trakt.js';

try { initTrakt(); } catch {}
initSync().catch(() => {});
