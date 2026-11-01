// Read-only account playback check. Output is deliberately limited to assertions and numbers.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

let browser, page, errors = 0, stage = 1;
const deadline = setTimeout(() => { console.log(`FAIL ${stage}`); process.exitCode = 1; browser?.close().finally(() => process.exit(1)); }, 175000);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn, timeout) {
  await page.waitForFunction(fn, { timeout, polling: 200 });
}
async function advancing(target, timeout) {
  await wait(`window.v && v.readyState >= 3 && Math.abs(v.currentTime - ${target}) <= 2 && !v.paused && !window.fatals`, timeout);
  const t = await page.evaluate(() => v.currentTime);
  await pause(700);
  if (!await page.evaluate(t => v.currentTime > t + .2, t)) throw new Error('no advancement');
}
try {
  const key = readFileSync(new URL('./.tbkey', import.meta.url), 'utf8').trim();
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  page = await browser.newPage();
  page.on('pageerror', () => errors++);
  page.on('console', m => { if (m.type() === 'error') errors++; });
  // A minimal same-origin document isolates engine errors from unrelated app services.
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().endsWith('/favicon.ico')) return r.respond({ status: 204 });
    if (r.isNavigationRequest()) return r.respond({ status: 200, contentType: 'text/html', body: '<meta name="referrer" content="no-referrer"><script type="importmap">{"imports":{"mediabunny":"/vendor/mediabunny.min.mjs"}}</script>' });
    r.continue();
  });
  await page.goto('http://localhost:5173');
  await page.evaluate(async key => {
    const call = async path => {
      const r = await fetch('/api/tb/' + path, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error('account request failed');
      return j.data;
    };
    const list = await call('torrents/mylist?bypass_cache=true');
    let chosen;
    for (const t of list || []) {
      if (!(t.download_present || t.download_finished)) continue;
      const f = (t.files || []).find(f => !f.infected && /\.mkv$/i.test(f.name || f.short_name || '') && !/sample|trailer/i.test(f.name || ''));
      if (f) {
        chosen ||= { t, f };
        // Keep the documented H.264 fixture stable when newer HEVC items lead the account list.
        if (f.short_name === 'Daily Dose of Sunshine S01E01.mkv') { chosen = { t, f }; break; }
      }
    }
    if (!chosen) throw new Error('no existing MKV');
    window.mediaUrl = await call(`torrents/requestdl?torrent_id=${chosen.t.id}&file_id=${chosen.f.id}`);
    window.attachMkv = (await import('/js/player/mkv.js')).attachMkv;
    window.fatals = 0;
    window.newVideo = () => {
      window.v = document.createElement('video'); v.muted = true; document.body.append(v);
      window.endedCount = 0; v.addEventListener('ended', () => window.endedCount++);
    };
    newVideo();
    window.attached = false;
    attachMkv(v, mediaUrl, { start: 120, onFatal: () => window.fatals++ }).then(d => {
      window.detach = d; window.attached = true; v.play().catch(() => window.fatals++);
    }).catch(() => window.fatals++);
  }, key);
  await wait('window.attached && v.currentTime >= 120 && v.currentTime <= 125 && v.readyState >= 3 && v.webkitAudioDecodedByteCount > 0 && !window.fatals', 30000);
  await advancing(122, 1000);
  console.log('PASS 1', await page.evaluate(() => +v.currentTime.toFixed(2)), await page.evaluate(() => v.webkitAudioDecodedByteCount));
  stage = 2;
  const before = await page.evaluate(() => v.currentTime);
  await pause(10000);
  const elapsed = await page.evaluate(t => v.currentTime - t, before);
  if (elapsed < 8 || elapsed > 12) throw new Error('playback drift');
  console.log('PASS 2', elapsed.toFixed(2));
  stage = 3;
  const duration = await page.evaluate(() => v.duration);
  const seek = async t => { await page.evaluate(t => { v.currentTime = t; v.play().catch(() => window.fatals++); }, t); await advancing(t, 25000); };
  await seek(duration * .5); console.log('PASS 3', await page.evaluate(() => +v.currentTime.toFixed(2)));
  stage = 4;
  await seek(60); console.log('PASS 4', await page.evaluate(() => +v.currentTime.toFixed(2)));
  stage = 5;
  for (const fraction of [.2, .7, .4]) { await page.evaluate(t => { v.currentTime = t; }, duration * fraction); await pause(200); }
  await advancing(duration * .4, 25000); console.log('PASS 5', await page.evaluate(() => +v.currentTime.toFixed(2)));
  stage = 6;
  await page.evaluate(t => { v.currentTime = t; }, duration - 20);
  await wait('window.endedCount > 0 && !window.fatals', 60000);
  // An EOF seek must reopen MSE and restart normally too.
  await seek(60);
  console.log('PASS 6', await page.evaluate(() => window.endedCount));
  stage = 7;
  await page.evaluate(async () => {
    detach(); v.remove(); newVideo();
    const controller = new AbortController();
    const pending = attachMkv(v, mediaUrl, { signal: controller.signal, onFatal: () => window.fatals++ });
    await new Promise(r => setTimeout(r, 500)); controller.abort();
    (await pending)(); v.remove(); newVideo();
    window.detach = await attachMkv(v, mediaUrl, { start: 120, onFatal: () => window.fatals++ });
    v.play().catch(() => window.fatals++);
  });
  await advancing(122, 30000);
  // Leaving during active playback must also release every writer.
  await page.evaluate(() => detach()); await pause(500);
  if (errors || await page.evaluate(() => window.fatals)) throw new Error('browser errors');
  console.log('PASS 7', errors);
  stage = 8;
  await page.evaluate(() => {
    v.remove(); newVideo();
    window.attached = false;
    attachMkv(v, mediaUrl, { start: 0, onFatal: () => window.fatals++ }).then(d => {
      window.detach = d; window.attached = true; v.play().catch(() => window.fatals++);
    }).catch(() => window.fatals++);
  });
  await page.waitForFunction('v.src && v.buffered.length === 0', { timeout: 30000, polling: 5 });
  await page.evaluate(() => {
    if (v.buffered.length) throw new Error('startup window missed');
    v.currentTime = 300;
  });
  await advancing(300, 30000);
  if (errors || await page.evaluate(() => window.fatals)) throw new Error('browser errors');
  console.log('PASS 8', await page.evaluate(() => +v.currentTime.toFixed(2)), errors);
  await page.evaluate(() => detach());
} catch {
  let state = [];
  if (page) state = await page.evaluate(() => [window.v?.currentTime || 0, window.v?.readyState || 0, window.fatals || 0, window.v?.error?.code || 0]).catch(() => []);
  console.log(`FAIL ${stage}`, errors, ...state);
  for (let i = stage + 1; i <= 8; i++) console.log(`NOT_RUN ${i}`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
