// Handover frames plus a throttled scroll measurement: node landing-perf.mjs <outdir>
import puppeteer from 'puppeteer-core';
const out = process.argv[2], port = process.env.PORT || 5198, pause = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
// film handover
let p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://localhost:${port}/?intro`, { waitUntil: 'load' });
await p.waitForFunction(() => { const v = document.querySelector('#intro video'); return v && v.currentTime > .5; }, { timeout: 20000 });
await p.evaluate(() => { const v = document.querySelector('#intro video'); v.currentTime = v.duration - .25; });
const t0 = Date.now(); let i = 0; let done = 0;
while (Date.now() - t0 < 7000) {
  await p.screenshot({ path: `${out}/hand-${String(i++).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 60 });
  const gone = await p.evaluate(() => !document.getElementById('intro'));
  if (gone && ++done > 3) break;
  await pause(180);
}
console.log('handover frames', i, 'errors', errs.join('; ') || 'none', 'pre', await p.evaluate(() => document.getElementById('landing').className));
await p.close();
// scroll under 4x CPU
p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await pause(2800);
const c = await p.createCDPSession(); await c.send('Performance.enable'); await c.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.RATE || 4) });
const metric = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const m0 = await metric();
const r = await p.evaluate(async () => {
  const end = document.documentElement.scrollHeight - innerHeight, ds = [], perScene = {}; let last = performance.now(); const T = 22000, t0 = last;
  await new Promise(res => { const f = now => { const d = now - last; last = now; ds.push(d); const y = end * (now - t0) / T; scrollTo(0, y);
    const sec = [...document.querySelectorAll('[data-scene]')].filter(e => e.getBoundingClientRect().top <= 0).pop()?.dataset.scene || 'top'; (perScene[sec] ||= []).push(d);
    now - t0 < T ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  const st = a => { const s = [...a].sort((x, y) => x - y); return { n: a.length, p50: +s[s.length >> 1].toFixed(1), p95: +s[s.length * .95 | 0].toFixed(1), max: +s[s.length - 1].toFixed(0), over33: a.filter(x => x > 34).length }; };
  return { all: st(ds), scenes: Object.fromEntries(Object.entries(perScene).map(([k, v]) => [k, st(v)])), lite: document.getElementById('landing').classList.contains('ld-lite') };
});
const m1 = await metric();
console.log(JSON.stringify(r)); console.log('layouts', m1.LayoutCount - m0.LayoutCount, 'recalcs', m1.RecalcStyleCount - m0.RecalcStyleCount);
await b.close();
