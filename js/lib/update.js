// iOS app only: at most once a day, looks for a newer Streamora release on GitHub and offers it (installed with SideStore).
import { html, render, useState } from '../../vendor/preact-htm.js';
import { Icon } from '../ui/components.js';

const API = 'https://api.github.com/repos/KNIGHTABDO/streamora/releases/latest';
const PAGE = 'https://github.com/KNIGHTABDO/streamora/releases/latest';
const DAY = 864e5;
const CHECKED = 'streamora:update-checked';
const DISMISSED = 'streamora:update-dismissed';

const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/** The native app's version from the player plugin, or null on the web or in an older .ipa without it. */
export async function nativeVersion() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  try { return (await cap.Plugins.StreamoraPlayer.capabilities()).version || null; } catch { return null; }
}

const parts = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
/** a is newer than b */
function isNewer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

function UpdateNotice({ version, url }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const close = () => { put(DISMISSED, version); setOpen(false); };
  return html`<div class="shell-update">
    <div class="toast ink-edge wide" role="status">
      <${Icon} name="sparkle" size=${20} />
      <span>Streamora ${version} is out</span>
      <a href=${url} target="_blank" rel="noopener">Get it</a>
      <button type="button" aria-label="Dismiss" onClick=${close}><${Icon} name="close" size=${16} /></button>
    </div>
  </div>`;
}

/** Called once after startup. Does nothing outside the iOS app, more than once a day, or without a known native version. */
export async function checkForUpdate() {
  const have = await nativeVersion();
  if (!have) return;
  if (Date.now() - (+get(CHECKED) || 0) < DAY) return;
  put(CHECKED, String(Date.now()));
  let rel;
  try {
    const r = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    rel = await r.json();
  } catch { return; }
  const latest = String((rel && rel.tag_name) || '').replace(/^v/, '');
  if (!latest || !isNewer(latest, have) || get(DISMISSED) === latest) return;
  const root = document.createElement('div');
  document.body.append(root);
  render(html`<${UpdateNotice} version=${latest} url=${rel.html_url || PAGE} />`, root);
}
