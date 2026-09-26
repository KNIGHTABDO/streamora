// Player smoke test: opens a watch url, waits for real playback, prints video state + errors, saves screenshots.
//   MSYS_NO_PATHCONV=1 node tools/playtest.mjs "#/watch/movie/tt1392214" [--phone] [--out name] [--secs 60] [--resume start|resume]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const hash = args.find(a => a.startsWith('#'));
const phone = flag('phone', false);
const out = flag('out', 'play');
const secs = +flag('secs', 90);
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5173/#/welcome');
await page.evaluate(async KEY => {
  const s = await import('/js/core/store.js');
  if (!s.profiles.get().length) s.profiles.set([{ id: 'test1', name: 'Tester', avatar: 'cat', theme: 'ink', ink: '#ff4f79' }]);
  s.activeProfileId.set('test1');
  s.settings.update(x => ({ ...x, nightAuto: false }));
  await s.saveRdKey(KEY);
}, KEY);
await page.goto('http://localhost:5173/' + hash);
await page.evaluate(() => location.reload());

const t0 = Date.now();
let shot = 0, last = null;
while (Date.now() - t0 < secs * 1000) {
  await new Promise(r => setTimeout(r, 3000));
  const st = await page.evaluate(() => {
    const v = document.querySelector('video');
    const step = document.querySelector('.watch-step, .watch-loading-card h2');
    const resume = document.querySelector('.watch-resume-card');
    return { url: (window.__hlsUrl||'').slice(30), log: (window.__hlsLog || []).slice(-6).join(','), v: v && { t: +v.currentTime.toFixed(1), rs: v.readyState, paused: v.paused, w: v.videoWidth, h: v.videoHeight, dur: v.duration, src: (v.currentSrc || '').slice(0, 90) }, step: step && step.textContent.trim().slice(0, 120), resume: !!resume };
  });
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(st));
  if (st.resume) { const which = flag('resume', 'start'); await page.evaluate(w => [...document.querySelectorAll('.watch-resume-card button')][w === 'resume' ? 0 : 1].click(), which); }
  if (!shot && st.step && !st.v) { await page.screenshot({ path: shots + out + '_loading.png' }); shot = 1; }
  if (st.v && st.v.rs >= 3 && st.v.t > 3 && last && st.v.t > last.t) {
    await page.mouse.move(700, 450); await page.mouse.move(720, 460);
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: shots + out + '_playing.png' });
    console.log('PLAYING OK');
    if (flag('menus', false)) {
      const snap = async (sel, name) => { await page.mouse.move(700, 400); await page.mouse.move(710, 410); await new Promise(r => setTimeout(r, 300)); const ok = await page.evaluate(s => { const b = document.querySelector(s); if (b) b.click(); return !!b; }, sel); await new Promise(r => setTimeout(r, 1800)); await page.screenshot({ path: shots + out + '_' + name + '.png' }); console.log(name, ok); };
      await snap('button[aria-label=Subtitles]', 'subs');
      await snap('button[aria-label=Settings]', 'settings');
      await snap('button[aria-label=Episodes]', 'episodes');
      await page.evaluate(() => document.querySelector('.pl-menu .pl-btn[aria-label=Close]')?.click());
      await snap('button[aria-label="Change source"]', 'picker');
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = v.duration - 18; });
      await new Promise(r => setTimeout(r, 9000));
      await page.screenshot({ path: shots + out + '_next.png' });
      console.log('next card', await page.evaluate(() => !!document.querySelector('.pl-next')));
    }
    break;
  }
  last = st.v;
}
if (flag('linger', false)) await new Promise(r => setTimeout(r, +flag('linger') * 1000));
await page.screenshot({ path: shots + out + '_end.png' }); console.log('url', page.url());
console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
if (flag('keep', false)) { globalThis.page = page; } else await browser.close();
