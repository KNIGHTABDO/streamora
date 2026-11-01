// Screenshots of each scroll stage: node landing-shots.mjs <outdir> [desktop|phone]
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || 'shots', kind = process.argv[3] || 'desktop', port = process.env.PORT || 5198;
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const p = await b.newPage();
await p.setViewport(kind === 'phone' ? { width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true } : { width: 1440, height: 900 });
const pause = ms => new Promise(r => setTimeout(r, ms));
const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text()));
p.on('response', r => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await pause(2800);
await p.screenshot({ path: `${out}/${kind}-00-top.jpg`, type: 'jpeg', quality: 70 });
const info = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, iw: innerWidth, surface: document.documentElement.dataset.surface, scenes: [...document.querySelectorAll('[data-scene],#ld-film,#ld-questions,#ld-ticket')].map(e => [e.id, Math.round(e.getBoundingClientRect().top + scrollY), e.offsetHeight]) }));
console.log(JSON.stringify(info));
const stops = [['hero', .6], ['diary', .3], ['diary', .65], ['diary', .92], ['moods', .4], ['town', .35], ['town', .9], ['dusk', .3], ['dusk', .85]];
let n = 1;
const frames = id => info.scenes.find(s => s[0] === 'ld-' + id);
for (const [id, f] of stops) {
  const [, top, h] = frames(id);
  await p.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), top + Math.max(0, h - (kind === 'phone' ? 844 : 900)) * f);
  await pause(900);
  await p.screenshot({ path: `${out}/${kind}-${String(n++).padStart(2, '0')}-${id}.jpg`, type: 'jpeg', quality: 70 });
}
for (const id of ['film', 'questions', 'ticket']) {
  await p.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), frames(id)[1]);
  await pause(800);
  await p.screenshot({ path: `${out}/${kind}-${String(n++).padStart(2, '0')}-${id}.jpg`, type: 'jpeg', quality: 70 });
}
console.log([...new Set(errs)].slice(0, 12).join('\n') || 'no errors');
await b.close();
