// First run: a tiny flip-book about Streamora, then the Real-Debrid key.
import { html, useState, useRef } from '../../vendor/preact-htm.js';
import { Btn, Input, Field, Reel, ErrorNote, Icon, loadCSS, toast } from '../ui/components.js';
import { saveRdKey, importAll } from '../core/store.js';
import { user } from '../core/rd.js';
import { navigate } from '../router.js';

loadCSS('css/pages/welcome.css');

const PAGES = [
  { mood: 'wave', title: 'Hi, I\'m Reel.', body: html`Streamora is a sketchbook that plays movies, shows and anime, streamed through <span class="mark">your own Real-Debrid</span>. No accounts, no sign-up.` },
  { mood: 'binoculars', title: 'Bring your own key', body: html`You'll need a premium Real-Debrid account. Grab your API key at <a class="welcome-link" href="https://real-debrid.com/apitoken" target="_blank" rel="noopener">real-debrid.com/apitoken</a> and paste it on the next page.` },
  { mood: 'love', title: 'It all stays here', body: html`Profiles, watchlists and progress live <span class="mark">only on this device</span>. Your key is encrypted in the browser, and the tiny relay just forwards requests to Real-Debrid without storing anything.` },
];

function Title() {
  return html`<svg class="welcome-title" viewBox="0 0 520 120" role="img" aria-label="Streamora">
    <text x="12" y="92" class="welcome-title-ink">Streamora</text>
    <text x="12" y="92" class="welcome-title-fill">Streamora</text>
    <path class="welcome-title-under" d="M16 108 C120 98 260 112 500 100" fill="none" pathLength="1"/>
  </svg>`;
}

export default function Welcome() {
  const [step, setStep] = useState(0);            // 0..2 story, 3 key
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [who, setWho] = useState(null);
  const file = useRef();

  const verify = async e => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const k = key.trim();
      const u = await user(k);
      if (u.type !== 'premium') throw new Error('This Real-Debrid account is not premium. Streaming needs premium.');
      const days = Math.max(0, Math.round((new Date(u.expiration) - Date.now()) / 864e5));
      setWho({ name: u.username, days });
      await saveRdKey(k);
      setTimeout(() => navigate('/profiles', { replace: true }), 1500);
    } catch (x) { setErr(x); setBusy(false); }
  };

  const onImport = async e => {
    const f = e.currentTarget.files[0];
    if (!f) return;
    try { importAll(JSON.parse(await f.text())); toast('Backup imported. Now add your key.', { icon: 'upload' }); setStep(3); }
    catch (x) { toast(x.message || 'That file is not a Streamora backup', { kind: 'error' }); }
    e.currentTarget.value = '';
  };

  const story = step < 3;
  const pg = PAGES[Math.min(step, 2)];
  return html`<main class="welcome">
    <div class="welcome-stage">
      <${Title} />
      <div class="welcome-book">
        <div class="welcome-page panel" key=${step}>
          <span class="tape top"></span>
          ${story ? html`
            <div class="welcome-reel"><${Reel} mood=${pg.mood} size=${150} /></div>
            <h2>${pg.title}</h2>
            <p class="welcome-body">${pg.body}</p>
            <div class="welcome-nav">
              <div class="welcome-dots" aria-hidden="true">${PAGES.map((_, i) => html`<span class=${i === step ? 'on' : ''}></span>`)}</div>
              <div class="cluster">
                ${step > 0 && html`<${Btn} variant="ghost" icon="back" onClick=${() => setStep(step - 1)}>Back<//>`}
                <${Btn} variant="primary" iconRight="next" onClick=${() => setStep(step + 1)}>${step === 2 ? 'Add my key' : 'Next'}<//>
              </div>
            </div>
            <button type="button" class="welcome-skip type" onClick=${() => setStep(3)}>skip →</button>
          ` : html`
            <form class="stack" onSubmit=${verify}>
              <div class="welcome-reel"><${Reel} mood=${who ? 'party' : busy ? 'think' : err ? 'sad' : 'popcorn'} size=${130} /></div>
              <h2>Your Real-Debrid key</h2>
              <${Field} label="API key" hint=${html`Find it at <a class="welcome-link" href="https://real-debrid.com/apitoken" target="_blank" rel="noopener">real-debrid.com/apitoken</a>`}>
                <${Input} value=${key} onInput=${e => setKey(e.currentTarget.value)} placeholder="Paste it here…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Real-Debrid API key" />
              <//>
              ${err && html`<${ErrorNote} error=${err} compact />`}
              ${who && html`<div class="welcome-stamp" role="status"><span>Premium ✓</span><b>${who.name}</b><small>${who.days} days left</small></div>`}
              <${Btn} variant="primary" size="lg" icon="key" type="submit" disabled=${busy || key.trim().length < 20}>${busy ? (who ? 'Welcome in!' : 'Checking…') : 'Let me in'}<//>
              <div class="spread welcome-foot">
                <button type="button" class="welcome-skip-inline" onClick=${() => setStep(2)}><${Icon} name="back" size=${16} /> back</button>
                <button type="button" class="welcome-skip-inline" onClick=${() => file.current.click()}><${Icon} name="upload" size=${16} /> Import a backup</button>
                <input ref=${file} type="file" accept="application/json,.json" hidden onChange=${onImport} />
              </div>
            </form>
          `}
        </div>
      </div>
    </div>
  </main>`;
}
