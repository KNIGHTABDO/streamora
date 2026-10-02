// Screenshot / smoke-test helper (needs `node dev-server.mjs` running on :5173).
//   node tools/shot.mjs "#/movies" [--phone] [--tv] [--theme riso] [--wait 4000] [--out name] [--click selector] [--fresh] [--seed-demo]
// Seeds the Real-Debrid key (tools/.rdkey) and a test profile, then prints console errors + saves tools/shots/<name>.png
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const hash = args.find(a => a.startsWith('#')) || '#/';
const phone = flag('phone', false), tv = flag('tv', false);
const theme = flag('theme', 'ink');
const wait = +flag('wait', 3500);
const out = flag('out', (hash.replace(/[^a-z0-9]+/gi, '_') || 'home') + (phone ? '_phone' : tv ? '_tv' : ''));
const base = 'http://localhost:' + (process.env.PORT || 5173);
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const exe = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/google-chrome');

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
if (phone) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else if (tv) await page.setViewport({ width: 1920, height: 1080 });
else await page.setViewport({ width: 1440, height: 900 });
if (phone) await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');

const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('requestfailed', r => { const u = r.url(); if (!/googleapis|fonts\.g|metahub|m\.media-amazon|kitsu\.app|\.ts$|\.m3u8/.test(u)) errors.push('[reqfail] ' + u + ' ' + (r.failure() && r.failure().errorText)); });

await page.goto(base + '/#/welcome', { waitUntil: 'domcontentloaded' });
if (!flag('fresh', false)) {
  await page.evaluate(async (KEY, theme) => {
    // keep the night theme out of screenshots unless asked for
    const s = await import('/js/core/store.js');
    if (!s.profiles.get().length) {
      s.profiles.set([{ id: 'test1', name: 'Tester', avatar: 'cat', theme, ink: '#ff4f79', created: Date.now() }]);
    } else s.profiles.update(p => p.map(x => ({ ...x, theme })));
    s.activeProfileId.set('test1');
    s.settings.update(x => ({ ...x, nightAuto: theme === 'blueprint' }));
    await s.saveRdKey(KEY);
    // pretend to be signed in to Google (Drive calls just fail quietly), so the sign-in gate lets us through
    const { idbSet } = await import('/js/core/idb.js');
    await idbSet('google', { refresh_token: 'shot', client: 'web', access_token: 'shot', exp: Date.now() + 36e5 });
    (await import('/js/core/google.js')).account.set({ sub: 'shot', email: 'tester@example.com', name: 'Tester', picture: '' });
  }, KEY, theme);
  if (flag('seed-demo', false)) {
    // demo watch history / diary / watchlist / follows (for Diary, Wrapped, Watchlist, Calendar)
    await page.evaluate(async () => {
      const s = await import('/js/core/store.js');
      const { demoData } = await import('/js/lib/stats.js');
      const { resolveTitle } = await import('/js/core/meta.js');
      const d = demoData(new Date().getFullYear());
      const now = Date.now();
      s.progress.set(d.progress);
      s.history.set(d.history.filter(h => h.at <= now).reverse());
      s.diary.set(d.diary.filter(h => h.at <= now));
      const shows = (await Promise.all(['Reacher', 'Slow Horses', 'The Bear', 'Severance', 'The Last of Us'].map(n => resolveTitle(n, null, 'series').catch(() => null)))).filter(Boolean);
      s.follows.set(shows.map(m => ({ id: m.id, type: m.type, name: m.name, poster: m.poster })));
      const films = (await Promise.all([['Prisoners', 2013], ['Interstellar', 2014], ['Spirited Away', 2001], ['Parasite', 2019], ['Arrival', 2016], ['Dune', 2021]].map(([n, y]) => resolveTitle(n, y, 'movie').catch(() => null)))).filter(Boolean);
      s.watchlist.set([...films, ...shows.slice(0, 3)].map((m, i) => ({ id: m.id, type: m.type, name: m.name, poster: m.poster, added: now - i * 864e5 })));
    });
  }
}
await page.goto(base + '/' + hash, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => errors.push('[goto] ' + e.message));
await page.evaluate(() => location.reload());
await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
const click = flag('click', null);
if (click) { await page.click(click).catch(e => errors.push('[click] ' + e.message)); }
await new Promise(r => setTimeout(r, wait));
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL(`./shots/${out}.png`, import.meta.url));
await page.screenshot({ path: file, fullPage: !!flag('full', false) });
console.log('saved', file);
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
