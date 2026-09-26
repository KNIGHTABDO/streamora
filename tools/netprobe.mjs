// Logs requests to the RD stream host while a watch URL plays.  node tools/netprobe.mjs "#/watch/..." [secs]
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const hash = process.argv[2], secs = +(process.argv[3] || 40);
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage();
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(1);
p.on('request', r => /stream\.real-debrid/.test(r.url()) && console.log(el(), 'REQ', r.url().replace(/^https:\/\/[^/]+/, '')));
p.on('requestfinished', r => /stream\.real-debrid/.test(r.url()) && console.log(el(), 'DONE', r.response() && r.response().status(), r.url().split('/').pop()));
p.on('requestfailed', r => /stream\.real-debrid/.test(r.url()) && console.log(el(), 'FAIL', r.failure() && r.failure().errorText, r.url().split('/').pop()));
p.on('console', m => m.type() === 'error' && console.log('console', m.text()));
await p.goto('http://localhost:5173/#/welcome');
await p.evaluate(async KEY => { const s = await import('/js/core/store.js'); if (!s.profiles.get().length) s.profiles.set([{ id: 't', name: 'T', avatar: 'cat', theme: 'ink', ink: '#f00' }]); s.activeProfileId.set(s.profiles.get()[0].id); await s.saveRdKey(KEY); }, KEY);
await p.goto('http://localhost:5173/' + hash);
await new Promise(r => setTimeout(r, secs * 1000));
console.log('video', await p.evaluate(() => { const v = document.querySelector('video'); return v && { t: v.currentTime, rs: v.readyState }; }));
await b.close();
