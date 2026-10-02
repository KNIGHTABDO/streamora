// First run: a tiny flip-book about Streamora, then "Continue with Google" (everything is saved in the account's
// private Drive folder), then the Real-Debrid key if Drive doesn't have one yet.
// Devices that used Streamora before Drive get one page and no way around it: sign in, and this device's data moves in.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Input, Field, Reel, ErrorNote, Spinner, loadCSS } from '../ui/components.js';
import { useStore, saveRdKey, keyStore, ls } from '../core/store.js';
import { user } from '../core/rd.js';
import { account, returning, signInWithRedirect, startDeviceSignIn, finishDeviceSignIn } from '../core/google.js';
import { syncNow } from '../core/sync.js';
import { isNative } from '../player/native.js';
import { navigate } from '../router.js';

loadCSS('css/pages/welcome.css');

const PAGES = [
  { mood: 'wave', title: 'Hi, I\'m Reel.', body: html`Streamora is a sketchbook that plays movies, shows and anime, streamed through <span class="mark">your own Real-Debrid</span>.` },
  { mood: 'binoculars', title: 'Bring your own key', body: html`You'll need a premium Real-Debrid account. Your API key is at <a class="welcome-link" href="https://real-debrid.com/apitoken" target="_blank" rel="noopener">real-debrid.com/apitoken</a>. You only paste it once.` },
  { mood: 'love', title: 'Kept in your Google Drive', body: html`Profiles, watchlists and progress are saved in a <span class="mark">Streamora folder in your Google Drive</span>, so every phone, laptop and TV you sign in on picks up where you left off. Streamora can only see the files it made, never your own.` },
];
// used Streamora on this device before it moved to Drive
const legacy = () => ls.get('profiles', []).length > 0 || !!ls.get('rdkey', null);

function Title() {
  return html`<svg class="welcome-title" viewBox="0 0 520 120" role="img" aria-label="Streamora">
    <text x="12" y="92" class="welcome-title-ink">Streamora</text>
    <text x="12" y="92" class="welcome-title-fill">Streamora</text>
    <path class="welcome-title-under" d="M16 108 C120 98 260 112 500 100" fill="none" pathLength="1"/>
  </svg>`;
}

const GoogleG = () => html`<svg class="welcome-g" viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

function loadQR() {
  return window.qrcode ? Promise.resolve(window.qrcode) : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js'; s.onload = () => res(window.qrcode); s.onerror = rej;
    document.head.appendChild(s);
  });
}

/** "Go to google.com/device and type this code" (TVs, and the iPhone app where Google blocks its sign-in page). */
function DeviceCode() {
  const [round, setRound] = useState(0);
  const [dc, setDc] = useState(null);
  const [qr, setQr] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => {
    const ab = new AbortController();
    setDc(null); setErr(null);
    (async () => {
      const code = await startDeviceSignIn();
      setDc(code);
      loadQR().then(q => { const c = q(0, 'M'); c.addData(code.verification_url); c.make(); setQr(c.createSvgTag({ cellSize: 4, margin: 2, scalable: true })); }).catch(() => {});
      await finishDeviceSignIn(code, ab.signal);
    })().catch(e => e.message !== 'Cancelled' && setErr(e));
    return () => ab.abort();
  }, [round]);
  if (err) return html`<div class="stack"><${ErrorNote} error=${err} compact /><div><${Btn} icon="refresh" onClick=${() => setRound(round + 1)}>Try again<//></div></div>`;
  if (!dc) return html`<${Spinner} label="asking Google for a code…" />`;
  const url = dc.verification_url.replace(/^https?:\/\//, '');
  return html`<div class="welcome-device stack">
    <p>On your phone or computer, open <a class="welcome-link" href=${dc.verification_url} target="_blank" rel="noopener">${url}</a> and type:</p>
    <b class="welcome-code type" aria-label=${`Code ${dc.user_code.split('').join(' ')}`}>${dc.user_code}</b>
    ${qr && html`<div class="welcome-qr" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: qr }}></div>`}
    <${Spinner} size=${40} label="waiting for Google…" />
    ${isNative() && html`<div><${Btn} variant="ghost" icon="refresh" onClick=${() => setRound(round + 1)}>New code<//></div>`}
  </div>`;
}

/** The sign-in page: Google redirect, or a code (always offered; the only way inside the iPhone app). */
function GoogleStep({ migrate, onBack }) {
  const [code, setCode] = useState(isNative());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => { setBusy(true); setErr(null); try { await signInWithRedirect(); } catch (x) { setErr(x); setBusy(false); } };
  return html`<div class="stack welcome-google">
    <div class="welcome-reel"><${Reel} mood=${migrate ? 'love' : err ? 'sad' : 'popcorn'} size=${130} /></div>
    ${migrate ? html`
      <h2>Streamora moved into your Google Drive</h2>
      <p class="welcome-body">From now on your profiles, watchlists, progress and key are kept in a <span class="mark">Streamora folder in your Google Drive</span> and stay in step on every device. Sign in once and everything on this device moves in with you.</p>`
    : html`<h2>Sign in to keep it all</h2>
      <p class="welcome-body">Use your Google account. Streamora can only see the files it makes in your Drive, nothing else.</p>`}
    ${err && html`<${ErrorNote} error=${err} compact />`}
    ${code ? html`<${DeviceCode} />` : html`
      <${Btn} variant="primary" size="lg" class="welcome-gbtn" onClick=${go} disabled=${busy}><${GoogleG} />${busy ? 'Opening Google…' : 'Continue with Google'}<//>
      <div class="spread welcome-foot">
        ${onBack ? html`<button type="button" class="welcome-skip-inline" onClick=${onBack}>← back</button>` : html`<span></span>`}
        <button type="button" class="welcome-skip-inline" onClick=${() => setCode(true)}>On a TV? Sign in with a code</button>
      </div>`}
    ${code && !isNative() && html`<div class="welcome-foot"><button type="button" class="welcome-skip-inline" onClick=${() => setCode(false)}>← sign in here instead</button></div>`}
  </div>`;
}

function KeyStep() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [who, setWho] = useState(null);
  const verify = async e => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const k = key.trim();
      const u = await user(k);
      if (u.type !== 'premium') throw new Error('This Real-Debrid account is not premium. Streaming needs premium.');
      setWho({ name: u.username, days: Math.max(0, Math.round((new Date(u.expiration) - Date.now()) / 864e5)) });
      await saveRdKey(k); // goes to Drive with everything else, so other devices won't ask
      setTimeout(() => navigate('/profiles', { replace: true }), 1500);
    } catch (x) { setErr(x); setBusy(false); }
  };
  return html`<form class="stack" onSubmit=${verify}>
    <div class="welcome-reel"><${Reel} mood=${who ? 'party' : busy ? 'think' : err ? 'sad' : 'popcorn'} size=${130} /></div>
    <h2>Your Real-Debrid key</h2>
    <${Field} label="API key" hint=${html`Find it at <a class="welcome-link" href="https://real-debrid.com/apitoken" target="_blank" rel="noopener">real-debrid.com/apitoken</a>. It's saved in your Drive, so you only do this once.`}>
      <${Input} value=${key} onInput=${e => setKey(e.currentTarget.value)} placeholder="Paste it here…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Real-Debrid API key" />
    <//>
    ${err && html`<${ErrorNote} error=${err} compact />`}
    ${who && html`<div class="welcome-stamp" role="status"><span>Premium ✓</span><b>${who.name}</b><small>${who.days} days left</small></div>`}
    <${Btn} variant="primary" size="lg" icon="key" type="submit" disabled=${busy || key.trim().length < 20}>${busy ? (who ? 'Welcome in!' : 'Checking…') : 'Let me in'}<//>
  </form>`;
}

export default function Welcome() {
  const acct = useStore(account);
  const key = useStore(keyStore);
  const [step, setStep] = useState(0);            // story pages 0..2, then 3 = Google
  const [back, setBack] = useState(returning ? 'busy' : null); // coming back from Google's page
  const [opened, setOpened] = useState(false);    // first Drive round done (it may bring the key along)
  const wasLegacy = useRef(legacy());

  useEffect(() => { returning && returning.then(() => setBack(null), e => setBack(e)); }, []);
  useEffect(() => {
    if (!acct) return;
    let alive = true;
    setOpened(false);
    syncNow().finally(() => alive && setOpened(true));
    return () => { alive = false; };
  }, [acct && acct.sub]);
  useEffect(() => { if (acct && key.set && opened) navigate('/profiles', { replace: true }); }, [acct, key.set, opened]);

  let page;
  if (back === 'busy') page = html`<${Spinner} label="signing you in…" />`;
  else if (acct && !opened) page = html`<div class="stack"><div class="welcome-reel"><${Reel} mood="binoculars" size=${130} /></div><${Spinner} label=${wasLegacy.current ? 'moving your things into Drive…' : 'opening your Drive…'} /></div>`;
  else if (acct && !key.set) page = html`<${KeyStep} />`;
  else if (acct) page = html`<${Spinner} label="here we go…" />`;
  else if (wasLegacy.current) page = html`<${GoogleStep} migrate />`;
  else if (step >= 3) page = html`<${GoogleStep} onBack=${() => setStep(2)} />`;
  else {
    const pg = PAGES[step];
    page = html`
      <div class="welcome-reel"><${Reel} mood=${pg.mood} size=${150} /></div>
      <h2>${pg.title}</h2>
      <p class="welcome-body">${pg.body}</p>
      <div class="welcome-nav">
        <div class="welcome-dots" aria-hidden="true">${PAGES.map((_, i) => html`<span class=${i === step ? 'on' : ''}></span>`)}</div>
        <div class="cluster">
          ${step > 0 && html`<${Btn} variant="ghost" icon="back" onClick=${() => setStep(step - 1)}>Back<//>`}
          <${Btn} variant="primary" iconRight="next" onClick=${() => setStep(step + 1)}>${step === 2 ? 'Sign in' : 'Next'}<//>
        </div>
      </div>
      <button type="button" class="welcome-skip type" onClick=${() => setStep(3)}>skip →</button>`;
  }
  const flip = back === 'busy' ? 'b' : acct ? (opened ? (key.set ? 'go' : 'k') : 'o') : wasLegacy.current ? 'm' : step;
  return html`<main class="welcome">
    <div class="welcome-stage">
      <${Title} />
      <div class="welcome-book">
        <div class="welcome-page panel" key=${flip}>
          <span class="tape top"></span>
          ${back && back !== 'busy' && html`<${ErrorNote} error=${back} compact />`}
          ${page}
        </div>
      </div>
    </div>
  </main>`;
}
