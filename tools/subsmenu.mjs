// Opens a watch URL, waits for playback, opens the subtitles menu, prints its rows and screenshots it.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const hash = process.argv[2];
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/#/welcome');
await p.evaluate(async K => { const s = await import('/js/core/store.js'); if (!s.profiles.get().length) s.profiles.set([{ id: 't', name: 'T', avatar: 'cat', theme: 'ink', ink: '#f00' }]); s.activeProfileId.set(s.profiles.get()[0].id); await s.saveRdKey(K); }, KEY);
await p.goto('http://localhost:5173/' + hash);
const t0 = Date.now();
while (Date.now() - t0 < 120000) { const ok = await p.evaluate(() => { const v = document.querySelector('video'); return v && v.currentTime > 2; }); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
await p.evaluate(() => document.querySelector('video').pause()); await p.mouse.move(700, 400); await new Promise(r => setTimeout(r, 500));
await p.click('button[aria-label="Subtitles"]');
await new Promise(r => setTimeout(r, 1500));
console.log(await p.evaluate(() => [...document.querySelectorAll('[class*="pl-menu"] *')].filter(e => e.children.length === 0 || e.tagName === 'BUTTON').map(e => e.textContent.trim()).filter(Boolean).slice(0, 30).join(' | ')));
await p.screenshot({ path: fileURLToPath(new URL('./shots/subsmenu.png', import.meta.url)) });
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
