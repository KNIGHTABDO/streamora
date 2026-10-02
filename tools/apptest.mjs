// The web player on the app's VLC engine, tested in Chrome with a fake native plugin (needs `node dev-server.mjs`).
//   node tools/apptest.mjs ["#/watch/series/tt0903747?v=tt0903747:1:1"]
// The fake engine paints a moving pattern *behind* the page (like VLC does in the app) and logs every call,
// so the screenshots show whether the page went transparent and the asserts check the controls drive the engine.
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const exe = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/google-chrome');
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const base = 'http://localhost:' + (process.env.PORT || 5173);
const hash = process.argv[2] || '#/watch/series/tt0903747?v=tt0903747:1:1';
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
const shotPath = n => new URL(`./shots/app-${n}.png`, import.meta.url).pathname;

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); // iPad-ish landscape
const errors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('[console] ' + m.text()));
await page.setRequestInterception(true);
page.on('request', r => (/www\.googleapis\.com|\/api\/google\/refresh/.test(r.url()) ? r.abort() : r.continue()));

// ---- the fake app shell + VLC engine
await page.evaluateOnNewDocument(() => {
  const listeners = {};
  const log = (window.__engine = { calls: [], state: null });
  const emit = (n, d) => (listeners[n] || []).forEach(f => f(d));
  let t = 0, dur = 0, playing = false, timer = null, rate = 1, bufferTicks = 0, audioId = 1, subId = -1;
  const tracks = () => emit('tracks', { audio: [{ id: -1, name: 'Disable' }, { id: 1, name: 'Track 1 - [English] 5.1' }, { id: 2, name: 'Track 2 - [Spanish]' }],
    subs: [{ id: -1, name: 'Disable' }, { id: 3, name: 'Track 3 - [English]' }, { id: 4, name: 'Track 4 - [French]' }], audioId, subId });
  const call = (name, fn) => async (a) => { log.calls.push([name, a || null]); return fn ? fn(a) : undefined; };
  const P = {
    addListener: (n, f) => { (listeners[n] ||= []).push(f); return Promise.resolve({ remove: () => { listeners[n] = listeners[n].filter(x => x !== f); } }); },
    capabilities: call('capabilities', () => ({ engine: true })),
    engineOpen: call('engineOpen', a => {
      t = a.start || 0; dur = 2700; playing = true; bufferTicks = 4;
      const bg = document.createElement('div');
      bg.id = '__vlc'; // "the native video", painted under everything
      bg.style.cssText = 'position:fixed;inset:0;z-index:-1;background:repeating-linear-gradient(45deg,#2b6 0 40px,#164 40px 80px)';
      document.documentElement.appendChild(bg);
      clearInterval(timer);
      timer = setInterval(() => {
        if (bufferTicks > 0) bufferTicks--; else if (playing) t += 0.25 * rate;
        const ended = t >= dur;
        if (ended) playing = false;
        log.state = { time: t, duration: dur, playing: playing && !bufferTicks, paused: !playing, buffering: playing && bufferTicks > 0, rate, width: 1920, height: 1080, ...(ended ? { ended: true } : {}) };
        emit('engine', log.state);
        if (!bufferTicks && !log.tracked) { log.tracked = true; tracks(); }
      }, 250);
    }),
    enginePlay: call('enginePlay', () => { playing = true; }),
    enginePause: call('enginePause', () => { playing = false; }),
    engineSeek: call('engineSeek', a => { t = a.time; bufferTicks = 2; }),
    engineRate: call('engineRate', a => { rate = a.rate; }),
    engineVolume: call('engineVolume'),
    engineAudio: call('engineAudio', a => { audioId = a.id; tracks(); }),
    engineSub: call('engineSub', a => { subId = a.id; tracks(); }),
    engineClose: call('engineClose', () => { clearInterval(timer); const b = document.getElementById('__vlc'); b && b.remove(); }),
    play: call('play'), close: call('close'), extras: call('extras'),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { StreamoraPlayer: P } };
});

// ---- signed-in test profile
await page.goto(base + '/#/welcome', { waitUntil: 'domcontentloaded' });
await page.evaluate(async KEY => {
  const s = await import('/js/core/store.js');
  s.profiles.set([{ id: 'app1', name: 'Tester', avatar: 'cat', theme: 'ink', ink: '#ff4f79', created: 1 }]);
  s.activeProfileId.set('app1');
  s.settings.update(x => ({ ...x, subsLang: 'eng', audioLang: 'eng', nightAuto: false }));
  await s.saveRdKey(KEY);
  const { idbSet } = await import('/js/core/idb.js');
  await idbSet('google', { refresh_token: 'x', client: 'web', access_token: 'x', exp: Date.now() + 36e5 });
  (await import('/js/core/google.js')).account.set({ sub: 'x', email: 't@example.com', name: 'T', picture: '' });
}, KEY);

await page.goto(base + '/' + hash, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
const wait = ms => new Promise(r => setTimeout(r, ms));
// the resume card may ask first
for (let i = 0; i < 90; i++) {
  const st = await page.evaluate(() => ({ open: window.__engine.calls.some(c => c[0] === 'engineOpen'), resume: !!document.querySelector('.watch-resume'), err: (document.querySelector('.watch-loading') || {}).innerText }));
  if (st.open) break;
  if (st.resume) await page.evaluate(() => [...document.querySelectorAll('.watch-resume button')].pop().click());
  await wait(1000);
}
const calls = () => page.evaluate(() => window.__engine.calls.map(c => c[0]));
assert.ok((await calls()).includes('engineOpen'), 'VLC engine opened: ' + (await calls()));
const open = await page.evaluate(() => window.__engine.calls.find(c => c[0] === 'engineOpen')[1]);
console.log('engineOpen', { ...open, url: open.url.slice(0, 50) + '…' });
assert.ok(!(await calls()).includes('play'), 'classic player not used');
await wait(3500);

// transparent page: the pixel in the middle of the screen is the fake engine's green, not the player's black
const px = async () => {
  await page.screenshot({ path: shotPath('probe') });
  return page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 3);
    const chain = []; for (let e = el; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor);
    return { cls: document.documentElement.className, opaque: chain.filter(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') };
  });
};
const tp = await px();
assert.ok(tp.cls.includes('vlc-on'), 'html.vlc-on set');
assert.deepEqual(tp.opaque, [], 'nothing opaque between the controls and the video: ' + JSON.stringify(tp.opaque));
await page.screenshot({ path: shotPath('1-controls') });

const ui = () => page.evaluate(() => document.querySelector('.player').className);
// tap the surface: controls hide, tap again: they come back

const tap = () => page.evaluate(() => document.querySelector('.pl-surface').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: 590, clientY: 300 })));
const before = await ui();               // they auto-hide ~3 s into playback
await tap(); await wait(450);
const after1 = await ui();
await page.screenshot({ path: shotPath(/hide-ui/.test(after1) ? '2-hidden' : '2-shown') });
await tap(); await wait(450);
const after2 = await ui();
assert.notEqual(/hide-ui/.test(before), /hide-ui/.test(after1), 'a tap toggles the controls');
assert.notEqual(/hide-ui/.test(after1), /hide-ui/.test(after2), 'another tap toggles them back');
if (/hide-ui/.test(after2)) { await tap(); await wait(450); }

// play / pause / seek / speed
const t0 = await page.evaluate(() => window.__engine.state.time);
await page.evaluate(() => document.querySelector('.pl-center .pl-play').click()); await wait(400);
assert.ok((await calls()).includes('enginePause'), 'pause reaches the engine');
await page.evaluate(() => document.querySelector('.pl-center .pl-play').click()); await wait(400);
assert.ok((await calls()).includes('enginePlay'), 'play reaches the engine');
await page.evaluate(() => document.querySelector('.pl-center .pl-skip10:last-child').click()); await wait(1500);
const seek = await page.evaluate(() => window.__engine.calls.filter(c => c[0] === 'engineSeek').pop());
assert.ok(seek && seek[1].time > t0 + 8, '+10 s seeks the engine: ' + JSON.stringify(seek));
const shown = await page.evaluate(() => document.querySelector('.pl-time').innerText);
console.log('time shown after +10s:', shown, '| engine', (await page.evaluate(() => window.__engine.state.time)).toFixed(1));

// subtitles menu: the file's tracks + OpenSubtitles; English file track auto-picked? (audio is English -> no)
await page.evaluate(() => document.querySelector('.pl-row button[aria-label="Subtitles"]').click()); await wait(600);
const subsMenu = await page.evaluate(() => document.querySelector('.pl-menu').innerText);
assert.match(subsMenu, /in the file/i); assert.match(subsMenu, /Track 3 - \[English\]/); assert.match(subsMenu, /Track 4 - \[French\]/);
await page.screenshot({ path: shotPath('3-subs') });
await page.evaluate(() => [...document.querySelectorAll('.pl-menu .pl-item')].find(b => /French/.test(b.innerText)).click()); await wait(500);
assert.deepEqual(await page.evaluate(() => window.__engine.calls.filter(c => c[0] === 'engineSub').pop()[1]), { id: 4 }, 'picking a file track selects it in VLC');
assert.match(await page.evaluate(() => [...document.querySelectorAll('.pl-menu .pl-item.on')].map(b => b.innerText).join()), /French/, 'menu shows it as on');
const os = await page.evaluate(() => [...document.querySelectorAll('.pl-menu .pl-sublang .pl-item')].length);
if (os) {
  await page.evaluate(() => document.querySelector('.pl-menu .pl-sublang .pl-item').click()); await wait(2500);
  assert.deepEqual(await page.evaluate(() => window.__engine.calls.filter(c => c[0] === 'engineSub').pop()[1]), { id: -1 }, 'an online subtitle turns the file track off');
  console.log('online subtitle line on screen:', JSON.stringify(await page.evaluate(() => (document.querySelector('.pl-subs') || {}).innerText || '(none at this moment)')));
} else console.log('(no OpenSubtitles results for this title)');
await page.evaluate(() => { const b = document.querySelector('.pl-menu-head .pl-btn'); b && b.click(); }); await wait(300);

// settings: no quality section, speed works, audio tracks from VLC
await page.evaluate(() => document.querySelector('.pl-row button[aria-label="Settings"]').click()); await wait(500);
const setMenu = await page.evaluate(() => document.querySelector('.pl-menu').innerText);
assert.ok(!/quality/i.test(setMenu), 'no quality picker on VLC');
assert.match(setMenu, /Track 2 - \[Spanish\]/, 'audio tracks from VLC');
await page.screenshot({ path: shotPath('4-settings') });
await page.evaluate(() => [...document.querySelectorAll('.pl-menu .pl-chip')].find(b => b.innerText.trim() === '1.5×').click()); await wait(300);
assert.deepEqual(await page.evaluate(() => window.__engine.calls.filter(c => c[0] === 'engineRate').pop()[1]), { rate: 1.5 });
await page.evaluate(() => [...document.querySelectorAll('.pl-menu .pl-chip')].find(b => /Spanish/.test(b.innerText)).click()); await wait(300);
assert.deepEqual(await page.evaluate(() => window.__engine.calls.filter(c => c[0] === 'engineAudio').pop()[1]), { id: 2 });
await page.evaluate(() => { const b = document.querySelector('.pl-menu-head .pl-btn'); b && b.click(); }); await wait(300);

// progress is saved while playing on VLC
await wait(5500);
const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('streamora:p:app1:progress') || '{}'));
const entry = Object.values(prog)[0];
assert.ok(entry && Object.values(entry.eps || {}).some(e => e.t > 0), 'progress saved: ' + JSON.stringify(entry && entry.eps));

// leaving closes the engine and the page is opaque again
await page.evaluate(() => document.querySelector('.pl-top .pl-btn').click()); await wait(1500);
assert.ok((await calls()).includes('engineClose'), 'engine closed on back');
assert.ok(!(await page.evaluate(() => document.documentElement.className)).includes('vlc-on'), 'page opaque again');

console.log(errors.length ? errors.join('\n') : 'no page errors');
assert.equal(errors.length, 0);
console.log('apptest: all passed');
await browser.close();
