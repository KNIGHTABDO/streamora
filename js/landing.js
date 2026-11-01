// The Ticket Stub landing. One passive scroll listener, one rAF loop that sleeps when nothing changes, and layout read only on resize.
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const outBack = t => { const c = 1.4; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const outCubic = t => 1 - (1 - t) ** 3;
const put = (el, css) => { if (el._t !== css) { el._t = css; el.style.transform = css; } };
const fade = (el, o) => { const v = o.toFixed(3); if (el._o !== v) { el._o = v; el.style.opacity = v; } };
const clip = (el, pct) => { const v = pct.toFixed(1); if (el._c !== v) { el._c = v; el.style.clipPath = `inset(0 ${v}% -5px 0)`; } };

// A deckled edge for each print: static, so it costs nothing after the first paint.
function deckle(el, seed) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts = [], n = 22, j = () => r() * 1.3;
  for (let i = 0; i <= n; i++) pts.push(`${(i / n * 100).toFixed(1)}% ${j().toFixed(2)}%`);
  for (let i = 1; i <= n; i++) pts.push(`${(100 - j()).toFixed(2)}% ${(i / n * 100).toFixed(1)}%`);
  for (let i = n - 1; i >= 0; i--) pts.push(`${(i / n * 100).toFixed(1)}% ${(100 - j()).toFixed(2)}%`);
  for (let i = n - 1; i > 0; i--) pts.push(`${j().toFixed(2)}% ${(i / n * 100).toFixed(1)}%`);
  el.style.clipPath = `polygon(${pts.join(',')})`;
}

const noSound = { unlock() {}, play() {}, on: false, toggle() { return false; }, preload() {} };

export default function init(boot) {
  const root = document.getElementById('landing');
  const html = document.documentElement;
  if (root.dataset.ready) return;
  root.dataset.ready = '1';
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!navigator.connection?.saveData;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const phone = () => innerWidth <= 820;
  let sfx = noSound;
  const soundReady = import('./landing/sfx.js').then(m => { sfx = m.sfx; paintSound(); }).catch(() => {});

  // ---- today, for real
  const now = new Date();
  const fmt = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  $('.pm-date').innerHTML = `${String(now.getDate()).padStart(2, '0')} ${now.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}<br>${now.getFullYear()}`;
  $('.tk-date').textContent = fmt(now);
  $$('[data-ago]').forEach(t => { t.textContent = fmt(new Date(now - t.dataset.ago * 864e5)); });
  let serial = 4700 + (now.getDate() * 13) % 90;
  $$('[data-serial]').forEach(s => { s.textContent = `No. 0${serial++}`; });
  $$('.deckle').forEach((d, i) => deckle(d, 9000 + i * 77));
  $$('.ld-h1 .w').forEach((w, i) => w.style.setProperty('--i', i));
  $$('.ld-strip li').forEach((w, i) => w.style.setProperty('--i', i));

  // ---- sound toggle, unlocked by the first gesture
  const soundBtn = $('.ld-sound');
  function paintSound() { soundBtn.setAttribute('aria-pressed', String(sfx.on)); }
  const unlock = () => { removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); soundReady.then(() => sfx.unlock()); };
  addEventListener('pointerdown', unlock, { passive: true }); addEventListener('keydown', unlock, { passive: true });
  soundBtn.addEventListener('click', () => { sfx.toggle(); paintSound(); sfx.play('tick-mark'); });

  // ---- the opening
  let opened = false;
  function open(fromFilm) {
    if (opened) return; opened = true;
    root.classList.remove('pre');
    if (reduced) return;
    const seenThisSession = !fromFilm && !!boot.wasSeen;
    root.classList.add('opening');
    if (!fromFilm) root.classList.add('drop');
    if (seenThisSession) root.classList.add('quick');
    const u = seenThisSession ? .36 : 1;
    const at = (ms, fn) => setTimeout(fn, ms * u);
    if (!fromFilm) at(40, () => sfx.play('paper-drop'));
    at(260, () => sfx.play('paper-drop', { vol: .7 })); at(400, () => sfx.play('paper-drop', { vol: .6 }));
    at(950, () => { sfx.play('stamp'); root.classList.add('thump'); setTimeout(() => root.classList.remove('thump'), 140); });
    at(1420, () => sfx.play('stamp', { vol: .7, rate: 1.15 }));
    at(2300, () => root.classList.remove('opening', 'drop', 'quick'));
  }
  if (!reduced) root.classList.add('pre');
  if (html.hasAttribute('data-intro')) {
    addEventListener('streamora:landed', () => open(true), { once: true });
    addEventListener('streamora:chrome', () => setTimeout(() => open(true), 1800), { once: true }); // never stuck behind a broken handover
  } else if (reduced) root.classList.remove('pre');
  else requestAnimationFrame(() => open(false));

  // ---- scenes
  if (reduced) root.classList.add('ld-calm');
  const crossed = (st, key, p, th, fn) => { const was = st[key] ?? p; st[key] = p; if (was < th && p >= th) fn(); };

  const heroEls = { sheet: $('.ld-sheet'), dark: $('.ld-sheet-dark'), photos: $$('.ld-photos [data-depth]'), copy: $('.ld-hero-copy'), cat: $('.cat-walk') };
  const diary = { st: {}, stubs: [$('.s4'), $('.s3'), $('.s2'), $('.s1')], back: $('.cat-back'), box: { offsetH: 600, offsetW: 600 }, stage: $('.ld-stubs'), petals: [] };
  if (!reduced && !saveData) for (let i = 0; i < 7; i++) { const im = new Image(); im.src = 'media/ticket/blossom.webp'; im.alt = ''; im.loading = 'lazy'; im.className = 'ld-petal'; im.style.setProperty('--x', `${6 + i * 13}%`); im.style.setProperty('--s', `${10 + (i * 5) % 11}px`); $('.ld-diary-scene .ld-pin').append(im); diary.petals.push(im); }
  diary.parts = diary.stubs.map(s => ({ el: s, r: parseFloat(getComputedStyle(s).getPropertyValue('--r')) || 0, hand: [...s.querySelectorAll('.hand span')], stamp: s.querySelector('.dstamp') }));
  const mood = { st: {}, light: $('.ld-mood-light'), bat: $('.cat-bat'), leap: $('.cat-leap'), now: $('.ld-mood-now b'), wheel: null, lastIdx: -1 };
  const town = { st: {}, pops: $$('.pop'), tags: $$('.ld-tags li'), back: $('.ld-book-back'), page: $$('.ld-book-page')[1] };
  const dusk = { st: {}, day: $('.d-day'), night: $('.d-night'), note: $('.ld-note'), items: $$('.ld-note li') };
  // order of tags follows the order pieces rise: wall, tower, houses, gate, palm, tree
  const popTag = [5, 0, 1, 2, 3, 4];
  const MOOD_COL = { cozy: '#d29b45', mind: '#5b6aa8', cry: '#567a99', adrenaline: '#b8402a', comfort: '#a8804f', date: '#b4475e', weird: '#3c3166', lol: '#d8b13c' };

  const scenes = {
    hero(p) {
      if (phone()) return;
      const e = outCubic(seg(p, .02, 1));
      put(heroEls.sheet, `translate3d(0,${(-e * 3).toFixed(2)}vh,0) rotateX(${(e * 9).toFixed(2)}deg) scale(${(1 - e * .1).toFixed(4)})`);
      fade(heroEls.dark, e * .55);
      const vh = innerHeight;
      for (const ph of heroEls.photos) {
        const d = +ph.dataset.depth, r = ph.classList.contains('p-tree') ? -2.6 : ph.classList.contains('p-girl') ? 3 : ph.classList.contains('p-hero') ? 1.2 : 0;
        const side = ph.classList.contains('p-tree') ? -1 : 1;
        if (!ph._tilting && !root.classList.contains('opening')) put(ph, `translate3d(${(side * p * d * 90).toFixed(1)}px,${(-p * d * vh * .55).toFixed(1)}px,0) rotate(${(r + side * p * d * 10).toFixed(2)}deg)`);
      }
      if (!root.classList.contains('opening') && !root.classList.contains('pre')) {
        put(heroEls.cat, `translate3d(${(innerWidth * (-.08 + p * 1.3)).toFixed(1)}px,${(Math.abs(Math.sin(p * 40)) * -3).toFixed(1)}px,0)`);
      }
    },
    diary(p) {
      const vw = innerWidth, { st, parts } = diary, stageH = diary.box.offsetH, stageW = diary.box.offsetW;
      diary.petals.forEach((d, i) => put(d, `translate3d(${(Math.sin(p * 7 + i * 2) * 50).toFixed(1)}px,${(((p * (1.2 + i * .22) + i * .19) % 1.15) * innerHeight).toFixed(1)}px,0) rotate(${(p * 500 * (i % 2 ? 1 : -1) + i * 40).toFixed(1)}deg)`));
      parts.forEach((s, i) => {
        const a = .03 + i * .17, q = seg(p, a, a + .1), e = outBack(q);
        const side = i % 2 ? 1 : -.3;
        let x = (1 - e) * vw * .62 * (i % 2 ? 1 : .9), y = (1 - e) * innerHeight * (i % 2 ? .4 : -.55), r = s.r + (1 - e) * 34 * side;
        const dy = (i - 1.5) * stageH * .235; x += (i % 2 ? 1 : -1) * stageW * (phone() ? .025 : .15);
        if (i === 3) { const f = seg(p, .86, .97); x -= f * f * vw * .4; y += f * f * innerHeight * 1.0; r -= f * 62; }
        put(s.el, `translate3d(${x.toFixed(1)}px,${(y + dy).toFixed(1)}px,0) rotate(${r.toFixed(2)}deg)`);
        fade(s.el, q > 0 ? 1 : 0);
        crossed(st, 'd' + i, p, a + .015, () => sfx.play('card-deal'));
        s.hand.forEach((h, k) => {
          const hq = seg(p, a + .1 + k * .025, a + .125 + k * .025);
          clip(h, (1 - hq) * 100);
          crossed(st, `h${i}${k}`, p, a + .1 + k * .025, () => sfx.play('pen', { vol: .55 }));
        });
        if (s.stamp) {
          const b = a + .16, sq = seg(p, b, b + .012);
          fade(s.stamp, sq ? .9 : 0);
          put(s.stamp, `rotate(-3deg) scale(${(1.5 - sq * .5).toFixed(3)})`);
          crossed(st, 's' + i, p, b, () => sfx.play('stamp', { vol: .85 }));
        }
      });
      // the cat arrives on the pile, then knocks the top stub off
      const cq = seg(p, .71, .79), ce = outBack(cq), push = seg(p, .84, .88);
      fade(diary.back, cq > 0 ? 1 : 0);
      put(diary.back, `translate3d(${(-push * 26).toFixed(1)}px,${((1 - ce) * -innerHeight * .36).toFixed(1)}px,0) rotate(${(-push * 8).toFixed(2)}deg)`);
      crossed(st, 'cat', p, .86, () => sfx.play('paper-slide'));
    },
    mood(p, e) {
      const lq = seg(e, 0, 1);
      const on = lq > 0 && lq < 1 && !phone();
      if (on || mood.leap._o !== '0.000') {
        fade(mood.leap, on ? 1 : 0);
        put(mood.leap, `translate3d(${(innerWidth * (-.12 + lq * .95)).toFixed(1)}px,${(-Math.sin(lq * Math.PI) * innerHeight * .34).toFixed(1)}px,0) rotate(${((lq - .5) * 22).toFixed(1)}deg)`);
      }
      if (mood.wheel) mood.wheel.setProgress(p);
      fade(mood.light, seg(p, 0, .1) * (1 - seg(p, .92, 1)) * .17);
      const idx = (8 - Math.round(p * 8)) % 8; // the wheel turns clockwise, so the pointer reads backwards
      if (idx !== mood.lastIdx && mood.moods) { mood.lastIdx = idx; setMood(mood.moods[idx]); }
      put(mood.bat, `rotate(${(Math.sin(p * 44) * 3.5).toFixed(2)}deg)`);
    },
    town(p) {
      const { st, pops, tags } = town, n = pops.length;
      const q0 = outCubic(seg(p, 0, .16));
      put(town.page, `rotateX(${(26 * (1 - q0)).toFixed(2)}deg)`);
      put(town.back, `rotateX(${(78 * (1 - q0)).toFixed(2)}deg)`);
      const mobile = phone(); let cur = -1;
      pops.forEach((el, i) => {
        const a = .1 + i * .115, q = seg(p, a, a + .13), e = outBack(q);
        put(el, `rotateX(${(92 * (1 - e)).toFixed(2)}deg)`);
        crossed(st, 'p' + i, p, a + .02, () => sfx.play('flap', { vol: .8, rate: 1 + i * .03 }));
        const on = q > .5, t = tags[popTag[i]];
        if (t._on !== on) { t._on = on; t.classList.toggle('on', on); }
        if (on) cur = popTag[i];
      });
      if (mobile) tags.forEach((t, i) => { const c = i === cur; if (t._c !== c) { t._c = c; t.classList.toggle('cur', c); } });
    },
    dusk(p) {
      const { st, day, night, note, items } = dusk;
      const z = 1 + outCubic(seg(p, 0, .9)) * .2;
      const tr = `scale(${z.toFixed(4)})`;
      put(day, tr); put(night, tr);
      fade(night, seg(p, .2, .72));
      const q = outBack(seg(p, .1, .24));
      put(note, `translate3d(${((1 - q) * 110).toFixed(1)}vw,0,0) rotate(${(1.4 - (1 - q) * 14).toFixed(2)}deg)`);
      [.33, .49, .65].forEach((a, i) => {
        const on = p >= a;
        if (items[i]._on !== on) { items[i]._on = on; items[i].classList.toggle('on', on); }
        crossed(st, 't' + i, p, a, () => sfx.play('tick-mark'));
      });
    },
  };

  function setMood(m) {
    if (!m) return;
    mood.now.textContent = m.label;
    mood.light.style.backgroundColor = MOOD_COL[m.id] || '#a8281e';
  }

  // ---- the frame loop
  const list = $$('[data-scene]').map(el => ({ el, name: el.dataset.scene, top: 0, h: 0, live: false, last: -1 }));
  const punchTargets = ['#ld-hero', '#ld-film', '#ld-diary', '#ld-moods', '#ld-town', '#ld-dusk'].map(s => $(s));
  const punches = $$('.ld-punch li');
  const glow = $('.ld-glow');
  let vh = innerHeight, punchTops = [], ticking = 0, cur = scrollY, target = scrollY, lastT = 0, slow = 0, ema = 16;
  const lerped = finePointer && !reduced;

  function measure() {
    vh = innerHeight;
    const sy = scrollY;
    diary.box.offsetH = diary.stage.offsetHeight; diary.box.offsetW = diary.stage.offsetWidth;
    for (const s of list) { const r = s.el.getBoundingClientRect(); s.top = r.top + sy; s.h = s.el.offsetHeight; }
    punchTops = punchTargets.map(el => el.getBoundingClientRect().top + sy);
    kick();
  }
  function kick() { if (!ticking) ticking = requestAnimationFrame(frame); }
  function frame(t) {
    ticking = 0;
    target = scrollY;
    if (lerped) { cur += (target - cur) * .18; if (Math.abs(target - cur) < .4) cur = target; } else cur = target;
    for (const s of list) {
      const span = Math.max(1, s.h - vh);
      const inView = cur + vh > s.top - vh * .5 && cur < s.top + s.h + vh * .5;
      if (inView !== s.live) { s.live = inView; s.el.classList.toggle('live', inView); }
      if (!inView && s.done) continue;
      const p = clamp((cur - s.top) / span), e = clamp((cur - (s.top - vh)) / vh);
      if (p !== s.last || e !== s.lastE) { s.last = p; s.lastE = e; scenes[s.name](p, e); }
      s.done = !inView;
    }
    punches.forEach((li, i) => {
      const on = cur + vh * .55 >= punchTops[i];
      if (li._on !== on) { const was = li._on; li._on = on; li.classList.toggle('on', on); if (was === false && on) sfx.play('tick-mark', { vol: .4 }); }
    });
    // quality governor: a sustained run of slow frames drops the expensive layers, once
    if (lastT) { ema += ((t - lastT) - ema) * .05; if (ema > 25) slow++; else slow = Math.max(0, slow - 1); if (slow > 45 && !root.classList.contains('ld-lite')) root.classList.add('ld-lite'); }
    lastT = t;
    if (cur !== target) kick(); else lastT = 0;
  }
  if (!reduced) {
    addEventListener('scroll', kick, { passive: true });
    let rz = 0;
    const onResize = () => { clearTimeout(rz); rz = setTimeout(measure, 120); };
    addEventListener('resize', onResize, { passive: true });
    new ResizeObserver(onResize).observe(root);
    measure();
    // the page is hidden while the film plays, and sizes only exist once it is shown
    addEventListener('streamora:chrome', () => { if (html.dataset.surface === 'landing') { measure(); } });
  } else {
    // calm version: everything already in its finished state
    scenes.diary(.8); fade(diary.back, 1); scenes.town(1); scenes.dusk(1); fade(dusk.night, 0);
    punches.forEach(li => li.classList.add('on'));
  }

  // ---- reveal
  const rv = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); rv.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach(el => rv.observe(el));

  // ---- parts built separately, attached only when the visitor is close
  const near = (el, fn) => {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '120% 0px' });
    io.observe(el);
  };
  near($('#ld-cinema'), () => import('./landing/cinema.js').then(async m => { await soundReady; m.initCinema($('#ld-cinema'), { sfx }); }).catch(() => {}));
  near($('#ld-wheel'), () => import('./landing/wheel.js').then(async m => {
    await soundReady;
    mood.moods = m.LANDING_MOODS;
    mood.wheel = m.initWheel($('#ld-wheel'), { sfx, onSettle: setMood, onPrint: setMood });
    kick();
  }).catch(() => {}));
  near($('#ld-flaps'), () => import('./landing/flaps.js').then(async m => { await soundReady; m.initFlaps($('#ld-flaps'), { sfx }); }).catch(() => {}));
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'css/landing-parts.css'; document.head.append(css);

  // ---- things the hand can do
  if (finePointer && !reduced && !saveData) {
    let mx = 0, my = 0, pending = 0, tilted = null;
    const paint = () => {
      pending = 0;
      put(glow, `translate3d(${mx}px,${my}px,0)`);
      if (tilted) {
        const r = tilted._rect, dx = (mx - r.left) / r.width - .5, dy = (my - r.top) / r.height - .5;
        const rot = tilted.classList.contains('p-tree') ? -2.6 : tilted.classList.contains('p-girl') ? 3 : 1.2;
        put(tilted, `rotateY(${(dx * 12).toFixed(2)}deg) rotateX(${(-dy * 12).toFixed(2)}deg) rotate(${rot}deg) scale(1.025)`);
        const g = tilted.querySelector('.gloss');
        g.style.opacity = '1'; put(g, `translate3d(${(dx * 44).toFixed(1)}%,0,0)`);
      }
    };
    addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; if (!glow.classList.contains('on')) glow.classList.add('on'); if (!pending) pending = requestAnimationFrame(paint); }, { passive: true });
    $$('.tilt').forEach(el => {
      el.addEventListener('pointerenter', () => { el._rect = el.getBoundingClientRect(); el._tilting = true; tilted = el; el.style.zIndex = 6; sfx.play('paper-slide', { vol: .25, rate: 1.3 }); });
      el.addEventListener('pointerleave', () => { el._tilting = false; tilted = null; el.style.zIndex = ''; el.querySelector('.gloss').style.opacity = '0'; list[0].last = -1; kick(); });
    });
  }

  // Empty paper takes a stamp.
  const marks = $('.ld-marks'), markArt = ['st-print', 'st-ring', 'st-waves'];
  let markN = 0;
  root.addEventListener('click', e => {
    const start = e.target.closest('[data-start]');
    if (start) { e.preventDefault(); return begin(start); }
    const anchor = e.target.closest('a[href^="#ld-"]');
    if (anchor) {
      e.preventDefault();
      const t = $(anchor.getAttribute('href'));
      t?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      sfx.play('page-turn', { vol: .6 });
      return;
    }
    if (reduced || e.target.closest('a,button,summary,details,input,video,#ld-wheel,#ld-cinema,.lp-flap,.ticket')) return;
    const rect = root.getBoundingClientRect();
    const img = document.createElement('img');
    img.src = `media/ticket/${markArt[markN % 3]}.webp`; img.alt = '';
    img.style.cssText = `left:${e.clientX - rect.left - 37}px;top:${e.clientY - rect.top - 30}px;--a:${(Math.random() * 36 - 18).toFixed(1)}deg`;
    marks.append(img);
    if (++markN > 12) marks.firstChild.remove();
    sfx.play('stamp', { vol: .6, rate: 1.1 });
  });

  // ---- Get started, and the ticket
  let entering = false;
  async function begin(el) {
    if (entering) return;
    entering = true;
    el.classList.add('is-pressed');
    el.setAttribute('aria-busy', 'true');
    if (el.classList.contains('tk-main')) await tear(1);
    else { sfx.play('stamp'); await new Promise(r => setTimeout(r, reduced ? 0 : 110)); }
    try { await boot.enterApp(); } catch {}
    entering = false;
    el.classList.remove('is-pressed'); el.removeAttribute('aria-busy');
  }
  const ticket = $('[data-ticket]'), tkMain = $('.tk-main'), tkStub = $('.tk-stub');
  function tear(dir) {
    sfx.play('tear');
    if (reduced) return Promise.resolve();
    const ease = 'cubic-bezier(.3,.1,.5,1)';
    tkMain.animate([{ transform: tkMain.style.transform || 'none' }, { transform: `translate3d(${dir * 26}vw,-22px,0) rotate(${dir * 9}deg)`, opacity: 0 }], { duration: 420, easing: ease, fill: 'forwards' });
    const a = tkStub.animate([{ transform: 'none' }, { transform: 'translate3d(-14px,70vh,0) rotate(-28deg)' }], { duration: 560, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' });
    return a.finished.then(() => { tkMain.getAnimations().forEach(x => x.cancel()); a.cancel(); tkMain.style.transform = ''; });
  }
  let drag = null, dragged = false;
  tkMain.addEventListener('pointerdown', e => { if (reduced || entering) return; drag = { x: e.clientX, id: e.pointerId }; dragged = false; });
  addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = clamp(e.clientX - drag.x, 0, 150);
    if (d > 6) dragged = true;
    tkMain.style.transform = `translate3d(${d}px,${-d * .04}px,0) rotate(${d * .035}deg)`;
    if (d >= 120 && !entering) { drag = null; begin(tkMain); }
  }, { passive: true });
  const dragEnd = () => { if (!drag) return; drag = null; if (!entering) tkMain.style.transform = ''; };
  addEventListener('pointerup', dragEnd, { passive: true }); addEventListener('pointercancel', dragEnd, { passive: true });
  tkMain.addEventListener('click', e => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } });

  // ---- warm the app for Get started, but never while the film is using the connection
  const warm = () => {
    if (html.hasAttribute('data-intro')) return;
    removeEventListener('streamora:chrome', warm);
    (window.requestIdleCallback || (fn => setTimeout(fn, 1200)))(() => {
      for (const href of ['css/paper.css', 'css/components.css', 'css/app.css', 'js/main.js']) {
        const link = document.createElement('link');
        Object.assign(link, { rel: 'prefetch', href });
        document.head.append(link);
      }
    });
  };
  if (!saveData) { addEventListener('streamora:chrome', warm); warm(); }
}
