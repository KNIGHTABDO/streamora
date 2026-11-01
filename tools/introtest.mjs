// End-to-end check of the boot gate and the welcome film. Needs: PORT=5198 node dev-server.mjs
//   node tools/introtest.mjs
import puppeteer from 'puppeteer-core';

const base = `http://localhost:${process.env.PORT || 5198}`;
const DAY = 864e5;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(hash, { seed = {}, signedIn = false, block, hang, reduced, autoplay = true, slow = false, saveData = false, stalled = false, canvas = '', stoppedRAF = false, brokenEnding = false, frameSlow = false, muted = false, viewport = { width: 1280, height: 720 } } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const log = { navs: 0, urls: [], surfaces: [] };
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    log.urls.push(u);
    if (/googleapis\.com|\/api\/google\/|strem\.|metahub|kitsu|fonts\.g|torbox/.test(u)) return r.abort();
    if (block && u.includes('.mp4')) return r.abort();
    if (hang && u.includes('.mp4')) return;
    r.continue();
  });
  // real visitors don't have navigator.webdriver, which would switch the film off
  await page.evaluateOnNewDocument((seed, signedIn, faults) => {
    window.__introProbe = { landed: 0, finishes: 0, ending: '', patch: '', sounds: [], illegalSound: false, usableAtLand: false };
    const probe = window.__introProbe;
    addEventListener('streamora:landed', () => {
      probe.landed++;
      const photo = document.querySelector('#ld-hero-print img');
      if (photo) { const r = photo.getBoundingClientRect(); probe.photoAtLand = { width: r.width, height: r.height }; }
      probe.usableAtLand = !document.documentElement.hasAttribute('data-intro') &&
        ['app', 'landing'].every(id => !document.getElementById(id)?.inert);
    });
    addEventListener('streamora:chrome', () => { if (!document.documentElement.hasAttribute('data-intro')) probe.finishes++; });
    const mediaPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const video = document.querySelector('#intro video');
      if (this.tagName === 'AUDIO' && video && probe.ending) {
        probe.sounds.push(this.src.split('/').pop());
        probe.illegalSound ||= video.muted;
      }
      return mediaPlay.apply(this, args);
    };
    if (faults.muted) document.addEventListener('playing', e => { if (e.target.tagName === 'VIDEO') e.target.muted = true; }, true);
    if (faults.frameSlow) {
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = cb => {
        const video = document.querySelector('#intro:not([data-ending]) video');
        return video && video.duration - video.currentTime < 6 ? setTimeout(() => request(cb), 45) : request(cb);
      };
    }
    if (faults.slow) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    else Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    if (faults.saveData) Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true }) });
    if (!faults.autoplay) HTMLMediaElement.prototype.play = function () { return Promise.reject(new Error('test autoplay refused')); };
    if (faults.stalled) {
      const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get() { return Math.min(.3, time.get.call(this)); }, set(v) { time.set.call(this, v); } });
    }
    if (faults.canvas) {
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (args[0] instanceof HTMLVideoElement) {
          if (faults.canvas === 'throw') throw new Error('test decoder unavailable');
          return; // blank decoder frame
        }
        return draw.apply(this, args);
      };
    }
    if (faults.stoppedRAF) {
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = cb => document.querySelector('#intro[data-ending]') ? 0 : request(cb);
    }
    if (faults.brokenEnding) {
      const bounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () { if (this.id === 'intro') throw new Error('test ending exception'); return bounds.call(this); };
    }
    new MutationObserver(() => {
      const root = document.getElementById('intro');
      if (!root) return;
      probe.video ||= root.querySelector('video');
      probe.ending = root.dataset.ending || probe.ending;
      probe.patch = root.dataset.patch || probe.patch;
      if (root.dataset.ending && !probe.started) probe.started = Date.now();
      const title = root.querySelector('.intro-card h1')?.textContent;
      if (title) probe.title = title;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ending', 'data-patch'] });
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    if (sessionStorage.getItem('seeded') !== '1') {
      sessionStorage.setItem('seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem('streamora:' + k, JSON.stringify(v));
      if (signedIn) {
        localStorage.setItem('streamora:google', JSON.stringify({ sub: 's', email: 't@example.com', name: 'Tess Tester', picture: '' }));
        localStorage.setItem('streamora:tbkey-state', JSON.stringify({ set: true }));
        localStorage.setItem('streamora:profiles', JSON.stringify([{ id: 'p1', name: 'Tess', avatar: 'cat', theme: 'ink', ink: '#ff4f79' }]));
        localStorage.setItem('streamora:activeProfile', JSON.stringify('p1'));
      }
    }
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => { (window.__surfaces ||= []).push(document.documentElement.dataset.surface); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-surface'] });
    });
  }, seed, signedIn, { autoplay, slow, saveData, stalled, canvas, stoppedRAF, brokenEnding, frameSlow, muted });
  page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) log.navs++; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // the app signs out if IndexedDB holds no token: place one before the visit that counts
  if (signedIn) {
    await page.goto(base + '/privacy.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { const { idbSet } = await import('/js/core/idb.js'); await idbSet('google', { refresh_token: 'x', client: 'web', access_token: 'x', exp: Date.now() + 36e5 }); });
    log.navs = 0; log.urls.length = 0;
  }
  await page.goto(base + '/' + hash, { waitUntil: 'domcontentloaded' });
  return { page, log, errors, close: () => ctx.close() };
}
const state = page => page.evaluate(() => ({
  surface: document.documentElement.dataset.surface,
  intro: !!document.getElementById('intro'),
  introAttr: document.documentElement.hasAttribute('data-intro'),
  video: !!document.querySelector('#intro video[src]'),
  time: document.querySelector('#intro video')?.currentTime || 0,
  paused: document.querySelector('#intro video')?.paused,
  muted: document.querySelector('#intro video')?.muted,
  card: document.querySelector('.intro-card h1')?.textContent || window.__introProbe?.title || '',
  welcomeShown: document.getElementById('intro')?.classList.contains('is-welcome') || false,
  landingVisible: (() => { const l = document.getElementById('landing'); return !!l && getComputedStyle(l).display !== 'none' && getComputedStyle(l).visibility !== 'hidden'; })(),
  app: document.getElementById('app')?.childElementCount || 0,
  hash: location.hash,
  seen: localStorage.getItem('streamora:intro-seen'),
  ending: window.__introProbe?.ending,
  patch: window.__introProbe?.patch,
  landed: window.__introProbe?.landed,
  finishes: window.__introProbe?.finishes,
  usableAtLand: window.__introProbe?.usableAtLand,
  released: !window.__introProbe?.video?.hasAttribute('src'),
  inert: ['app', 'landing'].some(id => document.getElementById(id)?.inert),
  styles: [...document.querySelectorAll('style')].some(s => s.textContent.includes('#intro {')),
  sequenceElapsed: Date.now() - (window.__introProbe?.started || Date.now()),
}));
const until = async (page, fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await state(page); if (fn(s)) return s; await sleep(100); } return state(page); };
const usable = s => !s.intro && !s.introAttr && !s.inert && s.landed === 1 && s.usableAtLand && s.released && !s.styles;
const cleanupCheck = async (name, t) => {
  await t.page.waitForFunction(() => document.getElementById('intro') || window.__introProbe?.landed, { timeout: 12000 });
  const s = await until(t.page, x => !x.intro, 12000);
  await t.page.evaluate(() => { window.__keyWorks = false; addEventListener('keydown', e => { window.__keyWorks = !e.defaultPrevented; }, { once: true }); });
  await t.page.keyboard.press('Tab');
  check(name + ': usable page, one handover/event, released decoder, layers and key block removed', usable(s) && s.finishes === 1 && await t.page.evaluate(() => window.__keyWorks), JSON.stringify({ ending: s.ending, landed: s.landed, finishes: s.finishes }));
  return s;
};
const jumpToEnd = page => page.evaluate(() => { const v = document.querySelector('#intro video'); v.currentTime = v.duration - 1.5; });

// --- first visit, signed out
{
  const t = await open('');
  let s = await until(t.page, x => x.time > .5);
  check('first visit plays the film', s.intro && s.time > .5 && !s.paused);
  check('landing hidden behind the film', !s.landingVisible);
  const before = s.time;
  await t.page.keyboard.press('Escape'); await t.page.keyboard.press('Space');
  await t.page.mouse.click(600, 300);
  await sleep(700);
  s = await state(t.page);
  check('keys and clicks do not skip or pause', s.intro && !s.paused && s.time > before);
  check('no film-controls attribute', await t.page.evaluate(() => !document.querySelector('#intro video').controls));
  check('app bundle not loaded during the film', !t.log.urls.some(u => u.endsWith('/js/main.js')));
  check('landing clips and parts not fetched during the film', !t.log.urls.some(u => /media\/ticket\/.*\.mp4|js\/landing\/(cinema|wheel|flaps)/.test(u)));
  check('ending sounds preload only after film playback', t.log.urls.some(u => /sfx\/tear\.m4a/.test(u)));
  await jumpToEnd(t.page);
  s = await until(t.page, x => x.ending === 'peel');
  check('natural end starts the peel with a sampled mark patch', s.ending === 'peel' && s.patch === 'sampled');
  await until(t.page, x => !x.introAttr);
  const click = await t.page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'intro-click-probe'; button.textContent = 'test';
    Object.assign(button.style, { position: 'fixed', left: '8px', top: '8px', zIndex: '9999' });
    button.onclick = () => { window.__clickedDuringPeel = true; }; document.getElementById('landing').append(button);
    return getComputedStyle(document.getElementById('intro')).pointerEvents;
  });
  await t.page.mouse.click(20, 20);
  check('page accepts clicks during peel before landing', click === 'none' && await t.page.evaluate(() => !!window.__clickedDuringPeel));
  await t.page.evaluate(() => document.getElementById('intro-click-probe')?.remove());
  s = await until(t.page, x => x.welcomeShown);
  check('ends on the welcome', s.card === 'Welcome to Streamora.', s.card);
  s = await until(t.page, x => !x.intro);
  check('welcome hands over to the landing', s.surface === 'landing' && s.landingVisible && !!s.seen);
  await cleanupCheck('natural peel', t);
  check('hero receives the frozen photo without changing its dimensions', await t.page.evaluate(() => {
    const image = document.querySelector('#ld-hero-print img'), before = window.__introProbe.photoAtLand;
    const after = image.getBoundingClientRect();
    return image.src.startsWith('data:image/jpeg') && Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1;
  }));
  check('sound-on ending plays all five effects', await t.page.evaluate(() => {
    const p = window.__introProbe;
    return !p.illegalSound && ['wheel-thunk', 'tear', 'paper-drop', 'stamp', 'flap'].every(s => p.sounds.includes(s + '.m4a'));
  }));
  check('single page load', t.log.navs === 1, `navs ${t.log.navs}`);
  await t.close();
}
// --- returning visitors
{
  const t = await open('', { seed: { 'intro-seen': Date.now() - DAY, 'last-seen': Date.now() - DAY } });
  await sleep(600);
  const s = await state(t.page);
  check('signed out, seen recently: landing, no film', s.surface === 'landing' && !s.intro && s.landingVisible);
  check('landing never runs the app', await t.page.evaluate(() => !document.querySelector('link[rel=stylesheet][href*="paper.css"]') && !document.getElementById('app').childElementCount));
  check('landing skips the film file', !t.log.urls.some(u => /film-\d+\.mp4/.test(u)));
  await t.close();
}
{
  const t = await open('', { signedIn: true, seed: { 'intro-seen': Date.now() - DAY, 'last-seen': Date.now() - DAY } });
  await t.page.waitForSelector('.topnav', { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const s = await state(t.page);
  const surfaces = await t.page.evaluate(() => window.__surfaces || []);
  check('signed in: straight into the app', s.surface === 'app' && s.app > 0 && !s.intro && !s.landingVisible);
  check('signed in: landing assets never touched', !t.log.urls.some(u => /landing/.test(u)));
  check('signed in: one load and no surface change', t.log.navs === 1 && surfaces.every(x => x === 'app'), `navs ${t.log.navs}, ${surfaces.join()}`);
  await t.close();
}
{
  const t = await open('', { signedIn: true, seed: { 'intro-seen': Date.now() - 40 * DAY, 'last-seen': Date.now() - 31 * DAY } });
  let s = await until(t.page, x => x.time > .3);
  check('signed in, 31 days away: film plays', s.intro && s.time > .3);
  check('app waits for the end of the film', !t.log.urls.some(u => u.endsWith('/js/main.js')));
  await jumpToEnd(t.page);
  s = await until(t.page, x => x.welcomeShown || (x.landed && !x.intro));
  check('welcomes them back by name', s.card === 'Welcome back, Tess.', s.card);
  s = await until(t.page, x => !x.intro);
  check('hands over to the mounted app', s.surface === 'app' && s.app > 0 && t.log.navs === 1);
  check('app ending never fetches the cat', !t.log.urls.some(u => /cat-bat\.webp/.test(u)));
  await cleanupCheck('app peel', t);
  await t.close();
}
{
  const t = await open('', { seed: { 'intro-seen': Date.now() - 40 * DAY, 'last-seen': Date.now() - 2 * DAY } });
  await sleep(500);
  check('old film, recent visit: no film', !(await state(t.page)).intro);
  await t.close();
}
{
  const t = await open('#/watch/movie/tt1', { signedIn: true, seed: { 'intro-seen': Date.now() - 40 * DAY, 'last-seen': Date.now() - 40 * DAY } });
  await sleep(500);
  check('opening a film directly is never interrupted', !(await state(t.page)).intro);
  await t.close();
}
// --- failure never traps
{
  const t = await open('', { block: true });
  const s = await until(t.page, x => x.welcomeShown, 12000);
  check('video error: goes to the welcome', s.welcomeShown);
  const e = await until(t.page, x => !x.intro);
  check('video error: reaches the landing without peeling', !e.intro && e.landingVisible && e.ending === 'fade');
  await cleanupCheck('video error', t);
  await t.close();
}
{
  const t = await open('', { hang: true });
  const started = Date.now();
  const s = await until(t.page, x => x.welcomeShown, 14000);
  check('hung network: gives up on its own', s.welcomeShown && s.ending === 'fade', `${Date.now() - started} ms`);
  await cleanupCheck('buffer timeout', t);
  await t.close();
}
{
  const t = await open('', { reduced: true });
  const s = await until(t.page, x => x.welcomeShown, 4000);
  check('reduced motion: still welcome only, no film', s.welcomeShown && s.ending === 'fade' && !t.log.urls.some(u => /film-\d+\.mp4/.test(u)));
  await cleanupCheck('reduced motion', t);
  await t.close();
}

// --- every bypass and the bounded sequence cleanup
for (const [name, options] of [
  ['Save-Data', { saveData: true }], ['all autoplay refused', { autoplay: false }], ['stall watchdog', { stalled: true }],
]) {
  const t = await open('', options);
  const s = await cleanupCheck(name, t);
  check(name + ': no peel', s.ending === 'fade');
  await t.close();
}
for (const [name, options] of [
  ['portrait peel', { viewport: { width: 390, height: 844 } }],
  ['slow device', { slow: true }], ['measured slow frames', { frameSlow: true }], ['silent film', { muted: true }], ['canvas throws', { canvas: 'throw' }], ['blank canvas', { canvas: 'blank' }],
  ['rAF stopped', { stoppedRAF: true }], ['ending exception', { brokenEnding: true }],
]) {
  const t = await open('', options);
  await until(t.page, x => x.time > .3);
  await jumpToEnd(t.page);
  if (name === 'portrait peel') {
    await until(t.page, x => x.ending === 'peel');
    const aligned = await t.page.evaluate(() => {
      const m = document.querySelector('.intro-mark')?.getBoundingClientRect();
      const r = document.getElementById('intro')?.getBoundingClientRect();
      return m && r && Math.abs(m.left + m.width / 2 - r.width / 2) < 1 && Math.abs(m.width - r.width * 168 / 1280) < 1;
    });
    check('portrait frozen mark matches the contain box', aligned);
  }
  const s = await cleanupCheck(name, t);
  if (options.muted) check('muted film has no ending sound', await t.page.evaluate(() => !window.__introProbe.sounds.length));
  if (options.slow || options.frameSlow) check(name + ' slides without flap or cat', s.ending === 'slide' && !t.log.urls.some(u => /cat-bat\.webp/.test(u)));
  if (options.canvas) check(name + ': video fallback records unavailable mark patch', s.patch === 'unavailable');
  if (options.stoppedRAF) check('hard watchdog completes without animation frames within six seconds', s.sequenceElapsed < 6400);
  await t.close();
}
{
  const t = await open('');
  await until(t.page, x => x.time > .3); await jumpToEnd(t.page);
  await until(t.page, x => x.ending === 'peel');
  await t.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const s = await cleanupCheck('hidden during sequence', t);
  check('hidden tab jumps directly to the end', s.sequenceElapsed < 600);
  await t.close();
}

// --- landing ↔ app with no page load
{
  const t = await open('', { seed: { 'intro-seen': Date.now(), 'last-seen': Date.now() } });
  await t.page.waitForSelector('#landing [data-start]', { timeout: 5000 });
  await t.page.evaluate(() => document.querySelector('#landing [data-start]').click());
  await t.page.waitForSelector('.welcome', { timeout: 15000 });
  await sleep(450);
  let s = await state(t.page);
  check('Get started opens the sign-in flow', s.surface === 'app' && s.hash === '#/welcome' && !s.landingVisible);
  await t.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(500);
  s = await state(t.page);
  check('Back returns to the landing', s.surface === 'landing' && s.landingVisible);
  await t.page.goForward().catch(() => {});
  await sleep(500);
  s = await state(t.page);
  check('Forward returns to sign-in', s.surface === 'app' && s.hash === '#/welcome');
  check('whole round trip: one page load', t.log.urls.filter(u => u === base + '/').length === 1);
  await t.close();
}
// --- returned from Google: no landing flash
{
  const t = await open('?state=x&error=access_denied');
  await sleep(700);
  const s = await state(t.page);
  check('back from Google: never the landing or the film', s.surface === 'app' && !s.intro);
  await t.close();
}
// --- default autoplay policy: unmuted play is refused, muted must carry on with a sound pill
{
  const strict = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=document-user-activation-required', '--mute-audio'] });
  const page = await strict.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const v = await page.evaluate(() => { const v = document.querySelector('#intro video'); return v && { muted: v.muted, paused: v.paused, t: v.currentTime, text: document.getElementById('intro').innerText }; });
  check('autoplay refused with sound: film runs muted', !!v && v.muted && !v.paused && v.t > 0, JSON.stringify(v));
  check('autoplay refused with sound: tap-for-sound shown', !!v && /sound/i.test(v.text));
  await page.mouse.click(640, 360); await sleep(400);
  const after = await page.evaluate(() => { const v = document.querySelector('#intro video'); return v && { muted: v.muted, paused: v.paused }; });
  check('tap turns the sound on and keeps playing', !!after && !after.muted && !after.paused, JSON.stringify(after));
  await strict.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
