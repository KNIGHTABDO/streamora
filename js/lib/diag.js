// Recent errors and warnings for Settings → About → Copy diagnostics. Kept in memory and mirrored to localStorage,
// so they survive a reload. main.js imports this first, so it also catches errors thrown while the modules below load.
import { VERSION } from '../version.js';

const KEY = 'streamora:diag';
const MAX = 200;
const buf = [];
let saveTimer = null;
let installed = false;

/** Hides keys, tokens and anything that looks like one. */
export const redact = s => String(s)
  .replace(/\beyJ[\w-]+\.[\w.-]+/g, '[redacted]')
  .replace(/\bya29\.[\w.-]+/g, '[redacted]')
  .replace(/\bbearer\s+\S+/gi, 'bearer [redacted]')
  .replace(/\b(api[_-]?key|access_token|refresh_token|token|secret|password|authorization|key)(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi, '$1$2[redacted]')
  .replace(/[\w-]{32,}/g, '[redacted]');

const fmt = v => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

function save() { try { localStorage.setItem(KEY, JSON.stringify(buf)); } catch {} }

function push(level, args) {
  const text = redact(args.filter(a => a !== undefined).map(fmt).join(' ')).slice(0, 300);
  buf.push({ t: Date.now(), level, text });
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}
// never throws and never logs (a failed log must not loop back into the console wrapper)
const log = (level, args) => { try { push(level, args); } catch {} };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) buf.push(...saved.slice(-MAX));
  } catch {}
}

/** Installs the hooks once. Runs when this module loads. */
export function installDiag() {
  if (installed) return;
  installed = true;
  load();
  addEventListener('error', e => log('error', [e.error || e.message, e.filename && `${e.filename}:${e.lineno}:${e.colno}`]));
  addEventListener('unhandledrejection', e => log('error', ['Unhandled promise rejection:', e.reason]));
  for (const level of ['error', 'warn']) {
    const orig = console[level];
    console[level] = (...args) => { log(level, args); return orig.apply(console, args); };
  }
}
installDiag();

export function clearDiag() {
  buf.length = 0;
  try { localStorage.removeItem(KEY); } catch {}
}

/** The report for "Copy diagnostics". `native` is the native app's version, or null on the web. */
export function diagnostics(native) {
  return redact([
    `Streamora ${VERSION}`,
    `App: ${native ? `native app ${native}` : 'web'}`,
    `Page: ${location.hash.split('?')[0] || '#/'}`,
    `Time: ${new Date().toISOString()}`,
    `User agent: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height} @${devicePixelRatio}x`,
    `Log (${buf.length}):`,
    ...buf.map(e => `${new Date(e.t).toISOString()} ${e.level}: ${e.text}`),
  ].join('\n'));
}

/** Clipboard first, then a hidden textarea for older WebViews. False when neither works. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}
