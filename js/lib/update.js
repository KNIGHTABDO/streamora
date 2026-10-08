// iOS app only: on launch and whenever the app comes back to the front, looks for a newer Streamora release on GitHub
// and offers it in a popup (installed with SideStore). "Later" hides it until the next launch.
import { html, render, useState } from '../../vendor/preact-htm.js';
import { Modal } from '../ui/components.js';

const API = 'https://api.github.com/repos/KNIGHTABDO/streamora/releases/latest';
const PAGE = 'https://github.com/KNIGHTABDO/streamora/releases/latest';
const GAP = 10 * 6e4;          // at most one GitHub call per 10 minutes (its unauthenticated limit is 60/hour)
let checked = 0, later = null, shown = false;

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

function UpdateNotice({ version, url, notes }) {
  const [open, setOpen] = useState(true);
  const close = () => { later = version; shown = false; setOpen(false); };
  return html`<${Modal} open=${open} onClose=${close} title="Update available">
    <h2 class="display">Streamora ${version} is out</h2>
    ${notes && html`<p class="faint" style="white-space:pre-line;max-height:40dvh;overflow:auto">${notes}</p>`}
    <p>Download the new .ipa and install it with SideStore.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn btn-ghost" onClick=${close}>Later</button>
      <a class="btn btn-primary" href=${url} target="_blank" rel="noopener" onClick=${close}>Update</a>
    </div>
  <//>`;
}

async function check() {
  const have = await nativeVersion();
  if (!have || shown || Date.now() - checked < GAP) return;
  checked = Date.now();
  let rel;
  try {
    const r = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) return;
    rel = await r.json();
  } catch { return; }
  const latest = String((rel && rel.tag_name) || '').replace(/^v/, '');
  if (!latest || !isNewer(latest, have) || later === latest || shown) return;
  shown = true;
  const root = document.createElement('div');
  document.body.append(root);
  const notes = /^Unsigned/.test(rel.body || '') ? '' : String(rel.body || '').replace(/\r/g, '').trim().slice(0, 600);
  render(html`<${UpdateNotice} version=${latest} url=${rel.html_url || PAGE} notes=${notes} />`, root);
}

/** Called once after startup: checks now and each time the app returns to the foreground. Does nothing outside the iOS app. */
export async function checkForUpdate() {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check().catch(() => {}));
  return check();
}
