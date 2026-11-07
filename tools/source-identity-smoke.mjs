// Deterministic app playback checks: fake provider/account data and tiny synthetic videos, no real account calls.
// Run a dev server, then: node tools/source-identity-smoke.mjs [--base http://localhost:5187] [--baseline http://localhost:5188]
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const base = arg('base') || 'http://localhost:5187', baseline = arg('baseline');
const dir = '/tmp/streamora-source-identity-smoke';
mkdirSync(dir, { recursive: true });
for (const [name, seconds] of [['wrong', 5163.5], ['right', 10356]]) {
  const path = `${dir}/${name}.mp4`;
  if (!existsSync(path)) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=2', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', path]);
}
const media = Object.fromEntries(['wrong', 'right'].map(name => [name, readFileSync(`${dir}/${name}.mp4`)]));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const movie = { id: 'tt33764258', type: 'movie', name: 'The Odyssey', year: 2026, runtime: '173 min', videos: [] };
const hashes = { wrong: 'a'.repeat(40), right: 'b'.repeat(40) };
const filename = name => `The.Odyssey.2026.1080p-${name}.mp4`;

async function run(name, { origin = base, onlyRight = false, hints = false, allWrong = false, resume = false, native = '', theme = 'ink', phone = false, screenshot = false, playbackSample = false, series = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage(), errors = [], links = [];
  await page.setViewport({ width: phone ? 390 : 1280, height: phone ? 844 : 800, isMobile: phone, hasTouch: phone });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(native => {
    window.__playback = [];
    addEventListener('streamora:playback', event => window.__playback.push(event.detail.state));
    window.__frames = [];
    document.addEventListener('playing', event => { if (event.target instanceof HTMLMediaElement) window.__frames.push(performance.now()); }, true);
    window.__longTasks = [];
    new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(x => ({ start: x.startTime, duration: x.duration })))).observe({ type: 'longtask', buffered: true });
    if (!native) return;
    const listeners = {}, log = window.__nativeCalls = [];
    let timer;
    const emit = (event, value) => (listeners[event] || []).slice().forEach(fn => fn(value));
    const stop = () => { clearInterval(timer); };
    const open = (args, classic) => {
      stop(); log.push(args.url.includes('wrong') ? 'wrong' : 'right');
      let time = args.start || 0;
      const duration = args.url.includes('wrong') ? 5163.5 : 10356;
      timer = setInterval(() => {
        time += .25;
        if (classic) { emit('metadata', { duration }); emit('progress', { position: time, duration, paused: false }); }
        else emit('engine', { time, duration, playing: true, paused: false, buffering: false, width: 320, height: 180, rate: 1 });
      }, 250);
    };
    const noop = async () => {};
    const plugin = {
      capabilities: async () => ({ engine: true }),
      addListener: async (event, fn) => { (listeners[event] ||= []).push(fn); return { remove() { listeners[event] = listeners[event].filter(x => x !== fn); } }; },
      engineOpen: async args => open(args, false), engineClose: async () => stop(), enginePlay: noop, enginePause: noop,
      engineRate: noop, engineVolume: noop, engineMeta: noop, engineAudio: noop, engineSub: noop, engineSeek: noop,
      play: async args => open(args, true), close: async () => { stop(); emit('closed', { duration: 5163.5, position: 10 }); }, extras: noop,
    };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { StreamoraPlayer: plugin } };
  }, native);
  await page.setRequestInterception(true);
  const meta = series ? { id: 'tt1', type: 'series', name: 'Show', runtime: '45 min', videos: [{ id: 'tt1:1:2', season: 1, episode: 2 }] } : movie;
  const offered = onlyRight ? ['right'] : allWrong ? ['wrong'] : ['wrong', 'right'];
  const releaseFilename = name => series ? 'Show.S01E02.mp4' : native === 'vlc' ? filename(name).replace('.mp4', '.mkv') : filename(name);
  const raw = offered.map(name => ({ infoHash: hashes[name], fileIdx: 0, name: '[TB+] 1080p', title: `${releaseFilename(name)}\n💾 ${name === 'wrong' ? 1 : 2} GB`, behaviorHints: { filename: releaseFilename(name), ...(hints && name === 'wrong' ? { duration: 5163.5 } : {}) } }));
  const torrents = offered.map((name, i) => ({ id: name === 'wrong' ? 1 : 2, hash: hashes[name], download_finished: true, name: releaseFilename(name), files: [{ id: 0, name: series && name === 'wrong' ? 'Show.S01E03.mp4' : releaseFilename(name), size: media[name].length }] }));
  page.on('request', async request => {
    const url = new URL(request.url());
    const json = value => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(value) });
    try {
      if (url.hostname === 'media.test') {
        const bytes = media[url.pathname.includes('wrong') ? 'wrong' : 'right'];
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
        const start = range ? +range[1] : 0, end = range?.[2] ? Math.min(+range[2], bytes.length - 1) : bytes.length - 1;
        return request.respond({ status: range ? 206 : 200, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
      }
      if (url.pathname.includes('/api/tb/')) {
        if (url.pathname.endsWith('/mylist')) return json({ success: true, data: torrents });
        if (url.pathname.endsWith('/checkcached')) return json({ success: true, data: Object.fromEntries(offered.map(name => [hashes[name], {}])) });
        if (url.pathname.endsWith('/requestdl')) {
          const name = url.searchParams.get('torrent_id') === '1' ? 'wrong' : 'right';
          links.push(name); return json({ success: true, data: `https://media.test/${name}.mp4` });
        }
        return json({ success: true, data: {} });
      }
      if (/\/meta\/(movie|series)\//.test(url.pathname)) return json({ meta });
      if (url.hostname === 'torrentio.strem.fun') return json({ streams: raw });
      if (/googleapis/.test(url.hostname)) return json({ sub: 'smoke', email: 'smoke@example.test', name: 'Smoke' });
      if (url.origin !== origin || url.pathname.startsWith('/api/')) return json({ streams: [], metas: [], subtitles: [], results: [], encrypted_str: 'mock-config' });
      return request.continue();
    } catch { try { await request.abort(); } catch {} }
  });
  try {
    await page.goto(origin + '/#/welcome', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async ({ movie, hashes, filename, resume, native, theme }) => {
      const s = await import('/js/core/store.js');
      s.profiles.set([{ id: 'smoke', name: 'Smoke', avatar: 'cat', theme, ink: '#ff4f79', created: 1 }]); s.activeProfileId.set('smoke');
      s.settings.update(x => ({ ...x, subsLang: 'off', nightAuto: false, appPlayer: native === 'classic' ? 'classic' : 'auto' }));
      await s.saveTbKey('source-identity-smoke-key');
      const { idbSet } = await import('/js/core/idb.js');
      await idbSet('google', { refresh_token: 'smoke', client: 'web', access_token: 'smoke', exp: Date.now() + 36e5 });
      (await import('/js/core/google.js')).account.set({ sub: 'smoke', email: 'smoke@example.test', name: 'Smoke' });
      if (resume) s.progress.set({ [movie.id]: { ...movie, last: null, source: { infoHash: hashes.wrong, filename }, eps: { _: { t: 300, dur: 5163, done: false } } } });
    }, { movie, hashes, filename: filename('wrong'), resume, native, theme });
    await page.goto(origin + '/#/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.st-body'));
    await page.evaluate(async () => { await Promise.all([import('/js/pages/watch.js'), import('/js/core/sources.js')]); });
    const tap = await page.evaluate(({ resume, series }) => {
      window.__playback = []; window.__frames = []; window.__longTasks = [];
      const at = performance.now();
      location.hash = (series ? '#/watch/series/tt1?v=tt1:1:2&t=' : '#/watch/movie/tt33764258?t=') + (resume ? '300' : '0') + (resume ? '&hash=' + 'a'.repeat(40) + '&fn=The.Odyssey.2026.1080p-wrong.mp4' : '');
      return at;
    }, { resume, series });
    await page.waitForFunction(({ allWrong, native }) => allWrong
      ? document.querySelector('.watch-loading h2')?.textContent === 'No matching copy found'
      : native ? window.__nativeCalls?.includes('right') && window.__playback.includes('start')
        : document.querySelector('video')?.duration > 10000 && !document.querySelector('video').paused,
    { timeout: 20000 }, { allWrong, native });
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await page.evaluate(tap => ({
      seconds: document.querySelector('video')?.currentTime || 0,
      runtime: document.querySelector('video')?.duration || 0,
      firstPlayingMs: window.__frames.find(x => x >= tap) - tap,
      events: window.__playback,
      native: window.__nativeCalls || [],
      progress: JSON.parse(localStorage.getItem('streamora:p:smoke:progress') || '{}'),
      rejections: JSON.parse(localStorage.getItem('streamora:source-rejections-v1') || '{}'),
      longTasks: window.__longTasks.filter(x => x.start >= tap),
      marks: performance.getEntriesByType('mark').filter(x => x.name.startsWith('play:') && x.startTime >= tap).map(x => [x.name, Math.round(x.startTime - tap)]),
    }), tap);
    assert.deepEqual(errors, [], name + ': page errors');
    if (allWrong) {
      assert.deepEqual(result.events, [], 'wrong film must never scrobble');
      assert.deepEqual(result.progress, {}, 'wrong film must never save progress');
    } else if (resume) assert.ok(result.seconds < 10, 'bad Resume must restart the correct movie at the beginning');
    if (hints || resume || onlyRight || series) assert.deepEqual(links, ['right'], 'known wrong copies must never request a link');
    if (!onlyRight && !hints && !resume && !series) {
      assert.ok(Object.keys(result.rejections).length > 0, 'actual runtime rejects a source even without provider hints');
      if (native) assert.deepEqual(result.native, ['wrong', 'right']);
    }
    if (playbackSample) {
      const sample = await page.evaluate(() => new Promise(resolve => {
        const start = performance.now(), gaps = []; let last = start;
        const video = document.querySelector('video'), from = video.currentTime;
        const tick = time => {
          gaps.push(time - last); last = time;
          if (time - start < 3000) return requestAnimationFrame(tick);
          gaps.sort((a, b) => a - b);
          resolve({ p95FrameMs: gaps[Math.floor(gaps.length * .95)], frames: gaps.length, advancedSeconds: video.currentTime - from, longTasks: window.__longTasks.filter(x => x.start >= start).length });
        };
        requestAnimationFrame(tick);
      }));
      assert.ok(sample.advancedSeconds > 2, 'healthy playback continues advancing');
      console.log(JSON.stringify({ name: name + '-playback', ...sample }));
    }
    if (screenshot) {
      if (!allWrong && !native) {
        await page.evaluate(() => document.querySelector('[aria-label="Change source"]')?.click());
        await page.waitForSelector('.watch-picker');
        assert.equal(await page.$$eval('.watch-src:disabled', rows => rows.length), 1);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    }
    console.log(JSON.stringify({ name, links, runtime: result.runtime, firstPlayingMs: Math.round(result.firstPlayingMs) || null, longTasks: result.longTasks.length, marks: result.marks, errors }));
    return { name, firstPlayingMs: result.firstPlayingMs, longTasks: result.longTasks.length };
  } finally { await context.close(); }
}

try {
  await run('known-mismatch', { hints: true, screenshot: true });
  await run('missing-episode', { series: true });
  await run('actual-mismatch-phone', { phone: true, screenshot: true });
  await run('all-wrong-blueprint', { allWrong: true, theme: 'blueprint', phone: true, screenshot: true });
  await run('bad-resume', { resume: true });
  await run('vlc-runtime', { native: 'vlc' });
  await run('classic-runtime', { native: 'classic' });
  const timings = [];
  if (baseline) {
    for (let i = 0; i < 6; i++) {
      timings.push(await run('before-' + i, { origin: baseline, onlyRight: true }));
      timings.push(await run('after-' + i, { onlyRight: true }));
    }
    const median = rows => rows.map(x => x.firstPlayingMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    console.log('startup median ms (CPU 4x):', JSON.stringify({ before: median(timings.filter(x => x.name.startsWith('before'))), after: median(timings.filter(x => x.name.startsWith('after'))) }));
    await run('before-smoothness', { origin: baseline, onlyRight: true, playbackSample: true });
    await run('after-smoothness', { onlyRight: true, playbackSample: true });
  }
  writeFileSync(`${dir}/results.json`, JSON.stringify(timings, null, 2));
  console.log('Source identity smoke checks passed. Artifacts:', dir);
} finally { await browser.close(); }
