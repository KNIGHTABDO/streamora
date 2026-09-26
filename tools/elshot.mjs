// Element screenshot: node tools/elshot.mjs "#/kit" ".selector" out [--phone]  (seeds key+profile like shot.mjs)
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [hash, sel, out = 'el'] = process.argv.slice(2);
const phone = process.argv.includes('--phone');
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const p = await b.newPage();
await p.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/#/welcome');
await p.evaluate(async KEY => { const s = await import('/js/core/store.js'); if (!s.profiles.get().length) s.profiles.set([{ id: 'test1', name: 'Tester', avatar: 'cat', theme: 'ink', ink: '#ff4f79' }]); s.activeProfileId.set('test1'); s.settings.update(x => ({ ...x, nightAuto: false })); await s.saveRdKey(KEY); }, KEY);
await p.goto('http://localhost:5173/' + hash); await p.evaluate(() => location.reload());
await new Promise(r => setTimeout(r, 3500));
const el = (await p.$$(sel))[+(process.env.IDX || 0)];
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
const f = fileURLToPath(new URL(`./shots/${out}.png`, import.meta.url));
await el.screenshot({ path: f }); console.log(f, errs.join('\n') || 'no errors'); await b.close();
