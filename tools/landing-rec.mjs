// Records the preview: film ending, handover, opening, the whole scroll. node landing-rec.mjs <out.webm> [phone]
import puppeteer from 'puppeteer-core';
const out = process.argv[2], phone = process.argv[3] === 'phone', port = process.env.PORT || 5198, pause = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 800 });
await p.goto(`http://localhost:${port}/?intro`, { waitUntil: 'load' });
await p.waitForFunction(() => { const v = document.querySelector('#intro video'); return v && v.currentTime > .5; }, { timeout: 20000 });
await p.evaluate(() => { const v = document.querySelector('#intro video'); v.currentTime = v.duration - 1.5; });
const rec = await p.screencast({ path: out, speed: 1 });
await p.waitForFunction(() => !document.getElementById('intro'), { timeout: 15000 });
await pause(3000);
await p.evaluate(() => new Promise(res => { const end = document.documentElement.scrollHeight - innerHeight, T = 42000, t0 = performance.now(); const f = n => { const t = Math.min(1, (n - t0) / T); scrollTo(0, end * t); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }));
await pause(800);
await rec.stop(); await b.close();
