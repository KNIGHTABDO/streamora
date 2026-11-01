// The film is non-skippable. Only a natural end can start The Peel; failures always hand over quickly.
const STALL_LIMIT = 6;
const START_LIMIT = 9000;
const BUFFER_GRACE = 3500;
const MOUNT_LEAD = 6;
const SEQUENCE_LIMIT = 6000;

const CSS = `
@font-face { font-family: 'Young Serif'; src: url('art/fonts/young-serif-normal.woff2') format('woff2'); font-display: swap; }
#intro { position:fixed; inset:0; z-index:2147483000; overflow:hidden; contain:strict; background:#05060c; color:#fff; user-select:none; -webkit-touch-callout:none; touch-action:none; }
#intro video { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#05060c; pointer-events:none; }
#intro .intro-sound { position:absolute; right:max(16px,env(safe-area-inset-right)); bottom:max(16px,env(safe-area-inset-bottom)); min-height:44px; padding:0 16px; border:1px solid #ffffff40; border-radius:24px; background:#141626d0; color:white; font:600 14px system-ui; cursor:pointer; }
#intro .intro-sound svg { width:18px; height:18px; vertical-align:middle; margin-right:8px; }
#intro .intro-sound[hidden] { display:none; }
#intro.is-sequence { background:transparent; }
#intro.is-open, #intro.is-open * { pointer-events:none !important; touch-action:auto; }
.intro-sheet, .intro-flight { position:absolute; left:0; top:0; background:#05060c; transform-origin:0 0; }
.intro-sheet > canvas, .intro-sheet > video { position:absolute; inset:0; width:100%; height:100%; }
.intro-clip { position:absolute; left:0; top:0; overflow:hidden; transform-origin:0 0; }
.intro-back { position:absolute; left:0; top:0; background:linear-gradient(135deg,#fff9e9 0%,#eee4ce 45%,#c6bba6 78%,#fff6e5 100%); transform-origin:0 0; }
.intro-shadow, .intro-fold { position:absolute; left:0; top:0; transform-origin:0 0; }
.intro-shadow { background:linear-gradient(90deg,transparent,rgba(30,17,8,.28) 45%,rgba(30,17,8,.08) 75%,transparent); }
.intro-fold { background:linear-gradient(90deg,transparent,#fff9e9aa 45%,#fffdf2 55%,#9e927d66 75%,transparent); }
.intro-mark { position:absolute; left:0; top:0; transform-origin:0 0; }
.intro-mark svg { width:100%; height:100%; overflow:visible; }
.intro-eyes { transform-box:fill-box; transform-origin:center; }
.intro-dot { position:absolute; left:0; top:0; width:5px; height:5px; border-radius:50%; background:#ffd23f; opacity:0; }
.intro-card { position:absolute; left:50%; top:58%; width:min(620px,88%); text-align:center; color:#a8281e; opacity:0; transform-origin:50% 50%; }
.intro-card .intro-tk { display:inline-block; padding:12px 22px; border:4px double currentColor; border-radius:6px; background:#f5e6cced; }
.intro-card h1 { margin:0; font:400 clamp(24px,4vw,44px)/1.15 'Young Serif',Georgia,serif; }
.intro-card p { margin:6px 0 0; font:14px/1.4 system-ui; }
#intro.is-quick .intro-card { top:50%; color:#a8281e; }
.intro-cat { position:absolute; left:0; top:0; object-fit:contain; transform-origin:50% 75%; }
`;

const MARK = `<svg viewBox="96 76 320 380"><path d="M362 320C426 350 442 404 404 430C370 454 324 430 280 442" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="30" stroke-linecap="round"/><path d="M362 320C426 350 442 404 404 430C370 454 324 430 280 442" fill="none" stroke="#ffd23f" stroke-width="9" stroke-dasharray="10 15"/><circle cx="256" cy="236" r="150" fill="#ffd23f"/><path d="M160 150q30-44 82-54" fill="none" stroke="#fff4c2" stroke-width="13" stroke-linecap="round"/><ellipse cx="176" cy="254" rx="22" ry="13" fill="#ff4f79" opacity=".55"/><ellipse cx="336" cy="254" rx="22" ry="13" fill="#ff4f79" opacity=".55"/><g class="intro-eyes"><ellipse cx="214" cy="222" rx="18" ry="25" fill="#17101e"/><ellipse cx="298" cy="222" rx="18" ry="25" fill="#17101e"/><circle cx="221" cy="212" r="7" fill="#fff"/><circle cx="305" cy="212" r="7" fill="#fff"/></g><path d="M212 274Q256 324 300 274Q256 292 212 274Z" fill="#17101e" stroke="#17101e" stroke-width="6" stroke-linejoin="round"/></svg>`;
const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>';

const wait = ms => new Promise(done => setTimeout(done, ms));

/** The film is too heavy for this visit: flashing motion on request for less, or a connection that couldn't carry it. */
export function filmAllowed({ reducedMotion, saveData, effectiveType }) {
  return !reducedMotion && !saveData && !['slow-2g', '2g'].includes(effectiveType);
}

/** 480p for anything phone-sized or on a slow link, 720p otherwise. */
export function filmSource({ width, height, saveData, downlink, effectiveType }) {
  const small = Math.max(width, height) <= 900;
  const slow = saveData || effectiveType === '3g' || (downlink > 0 && downlink < 3);
  return small || slow ? 'media/film-480.mp4' : 'media/film-720.mp4';
}

/** What the welcome says. */
export function welcomeLines({ signedIn, name, seenBefore }) {
  if (!signedIn) return ['Welcome to Streamora.', 'Movies, shows and anime, in one place.'];
  const who = name ? `, ${name}` : '';
  return seenBefore ? [`Welcome back${who}.`, 'Good to see you again.'] : [`Welcome${who}.`, 'Your Streamora is ready.'];
}

/** Waits until the film can start cleanly. Resolves false when nothing playable arrives in time. */
function buffered(video) {
  return new Promise(done => {
    const started = Date.now();
    const finish = ok => { clearInterval(tick); video.removeEventListener('canplaythrough', yes); video.removeEventListener('error', no); done(ok); };
    const yes = () => finish(true);
    const no = () => finish(false);
    const tick = setInterval(() => {
      const waited = Date.now() - started;
      if (waited >= BUFFER_GRACE && video.readyState >= 3) finish(true);
      else if (waited >= START_LIMIT) finish(false);
    }, 150);
    video.addEventListener('canplaythrough', yes);
    video.addEventListener('error', no);
  });
}

function visible() {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise(done => {
    const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); done(); } };
    document.addEventListener('visibilitychange', on);
  });
}

/** object-fit: contain in viewport CSS pixels, including portrait letterbox bars. */
export function letterboxRect(width, height, sourceWidth = 1280, sourceHeight = 720) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale, h = sourceHeight * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

/** The exact data-mark box from the 1280 × 720 end composition. */
export function markRect(rect) {
  return { left: rect.left + rect.width * 556 / 1280, top: rect.top + rect.height * 138 / 720,
    width: rect.width * 168 / 1280, height: rect.height * 200 / 720 };
}

/** Fold n·p = distance. A rotated rectangular clip keeps n·p <= distance.
 * Its inverse holds the front still; reflection maps the back across that same line.
 * All returned coordinates are CSS pixels. No DOM, layout, or animation state here.
 */
export function foldGeometry(width, height, progress) {
  const diagonal = Math.hypot(width, height), nx = width / diagonal, ny = height / diagonal;
  const distance = (diagonal + 32) * (1 - Math.min(1, Math.max(0, progress))) - 16;
  const size = diagonal * 2;
  return { nx, ny, distance, size, angle: Math.atan2(ny, nx) * 180 / Math.PI,
    x: nx * (distance - size) + ny * size,
    y: ny * (distance - size) - nx * size,
    reflection: [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, 2 * distance * nx, 2 * distance * ny] };
}

export function slowDevice({ saveData, hardwareConcurrency, deviceMemory, frameTimes = [] }) {
  return !!saveData || hardwareConcurrency <= 2 || deviceMemory <= 2 ||
    (frameTimes.length >= 12 && frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length > 32);
}

const clamp = x => Math.max(0, Math.min(1, x));
const segment = (t, start, duration) => clamp((t - start) / duration);
const ease = p => p * p * (3 - 2 * p); // resistance, acceleration, then a soft release
const out = p => 1 - (1 - p) ** 3;
const mix = (a, b, p) => a + (b - a) * p;
const put = (el, key, value) => {
  const values = el._introValues ||= {};
  if (values[key] !== value) { values[key] = value; el.style[key] = value; }
};
const transform = (el, value) => put(el, 'transform', value);
const opacity = (el, value) => put(el, 'opacity', clamp(value).toFixed(3));
const move = (x, y) => `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
const dimensions = (el, w, h) => { el.style.width = `${w}px`; el.style.height = `${h}px`; };

/** Freeze before moving the video: iOS can discard its picture on reparenting.
 * A tiny downsample detects blank/transparent decoder output, not just drawImage errors.
 */
function freezeFrame(video, width, height, box) {
  try {
    const canvas = document.createElement('canvas');
    // Match the film's own sharpness so the freeze isn't visible, within a 2.5 MP budget for phones.
    const ratio = Math.max(.5, Math.min(devicePixelRatio || 1, (video.videoWidth || 1280) / box.width, Math.sqrt(25e5 / (width * height))));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, box.left * ratio, box.top * ratio, box.width * ratio, box.height * ratio);
    const probe = document.createElement('canvas'); probe.width = probe.height = 24;
    const pc = probe.getContext('2d', { willReadFrequently: true });
    pc.drawImage(canvas, 0, 0, 24, 24);
    const pixels = pc.getImageData(0, 0, 24, 24).data;
    let min = 255, max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    if (max < 24 || max - min < 16) return null;
    return { canvas, ctx, ratio };
  } catch { return null; }
}

/** Sample both sides of each row, interpolating the dark gradient under the departing mark.
 * A feathered margin also removes the film's baked glow without a hard rectangle edge.
 */
function eraseMark(snapshot, mark, box) {
  try {
    const { canvas, ctx, ratio } = snapshot;
    const pad = mark.width * .24;
    const x = Math.max(1, Math.floor((mark.left - pad) * ratio));
    const y = Math.max(0, Math.floor((mark.top - pad) * ratio));
    const w = Math.min(canvas.width - x - 2, Math.ceil((mark.width + pad * 2) * ratio));
    const h = Math.min(Math.floor((box.top + box.height) * ratio) - y, Math.ceil((mark.height + pad * 2) * ratio));
    const image = ctx.getImageData(x, y, w, h), left = ctx.getImageData(x - 1, y, 1, h).data;
    const right = ctx.getImageData(x + w, y, 1, h).data;
    const feather = Math.max(1, pad * ratio * .7);
    for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
      const a = clamp(Math.min(col, w - 1 - col, row, h - 1 - row) / feather);
      for (let c = 0; c < 3; c++) {
        const i = (row * w + col) * 4 + c;
        image.data[i] = mix(image.data[i], mix(left[row * 4 + c], right[row * 4 + c], col / w), a);
      }
    }
    ctx.putImageData(image, x, y);
    return true;
  } catch { return false; }
}

export default async function intro(boot) {
  const conn = navigator.connection || {};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const underneath = [document.getElementById('app'), document.getElementById('landing')];
  underneath.forEach(el => { if (el) el.inert = true; });
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('div'); root.id = 'intro';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Streamora welcome film');
  root.innerHTML = `<div class="intro-clip" style="width:100%;height:100%"><div class="intro-sheet" style="width:100%;height:100%"><video playsinline webkit-playsinline disablepictureinpicture disableremoteplayback preload="auto" tabindex="-1" aria-hidden="true"></video></div></div>
    <button type="button" class="intro-sound" hidden>${SPEAKER}<span>Tap for sound</span></button>
    <div class="intro-card" role="status"><div class="intro-tk"><h1></h1><p></p></div></div>`;
  document.body.append(root);
  const video = root.querySelector('video'), sound = root.querySelector('.intro-sound');
  const card = root.querySelector('.intro-card');
  const app = boot.surface === 'app';
  const underneathReady = () => Promise.resolve().then(() => app ? boot.loadApp().then(() => boot.mounted) : boot.loadLanding());
  let done = false, cleaned = false, handedOver = false, landed = false, played = false;
  let watchdog = 0, deadline = 0, raf = 0, sequenceVisibility = null;
  let filmVisibility = () => {}, resolveSequence = () => {};
  const frameTimes = [];
  let previousFrame = 0;
  const audio = new Map();
  function preloadSound() {
    if (audio.size || done) return;
    // There is no dedicated hop in this set: wheel-thunk is the soft rubber impact.
    for (const name of ['wheel-thunk', 'tear', 'paper-drop', 'stamp', 'flap']) {
      try { const a = new Audio(`media/ticket/sfx/${name}.m4a`); a.preload = 'auto'; a.load(); audio.set(name, a); } catch {}
    }
  }
  function playSound(name) {
    if (!played || video.muted) return;
    try { const a = audio.get(name); if (a) { a.currentTime = 0; a.play().catch(() => {}); } } catch {}
  }
  function unmute() {
    if (done || !video.muted) return;
    video.muted = false; sound.hidden = true;
    if (video.paused && !video.ended) video.play().catch(() => {});
  }
  const block = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    e.preventDefault(); e.stopPropagation(); unmute();
  };
  addEventListener('keydown', block, true);
  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('click', unmute);
  function handover() {
    if (handedOver) return;
    handedOver = true;
    try { boot.finishIntro(); } finally {
      underneath.forEach(el => { if (el) el.inert = false; });
      root.classList.add('is-open'); root.removeAttribute('aria-modal');
      // Landing's entrance waits for landed; reveal its already-mounted content for the peel.
      if (!app) document.getElementById('landing')?.classList.remove('pre');
      removeEventListener('keydown', block, true);
    }
  }
  function land() {
    if (landed) return;
    landed = true;
    dispatchEvent(new Event('streamora:landed'));
  }
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(deadline); clearInterval(watchdog); cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', filmVisibility);
    if (sequenceVisibility) document.removeEventListener('visibilitychange', sequenceVisibility);
    // Independent finally blocks keep decoder release and layer removal unconditional.
    try { handover(); } finally {
      try { land(); } finally {
        removeEventListener('keydown', block, true);
        try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
        for (const a of audio.values()) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch {} }
        root.remove(); style.remove(); resolveSequence();
      }
    }
  }
  const finish = once(async natural => {
    done = true;
    clearInterval(watchdog); cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', filmVisibility);
    const ready = underneathReady().catch(() => {}); // also mount on exceptions or a hidden-tab exit
    deadline = setTimeout(cleanup, SEQUENCE_LIMIT);
    sequenceVisibility = () => { if (document.visibilityState === 'hidden') cleanup(); };
    document.addEventListener('visibilitychange', sequenceVisibility);
    if (document.visibilityState === 'hidden') { cleanup(); return; }
    try {
      video.pause(); sound.hidden = true;
      const [title, line] = welcomeLines({ signedIn: boot.signedIn(), name: boot.who(), seenBefore: boot.wasSeen });
      card.querySelector('h1').textContent = title;
      card.querySelector('p').textContent = line;
      const viewport = root.getBoundingClientRect(); // dvh-safe; no viewport/layout reads in the loop
      const w = viewport.width, h = viewport.height;
      const box = letterboxRect(w, h, video.videoWidth || 1280, video.videoHeight || 720);
      const mark = markRect(box);
      const printable = natural === true && video.readyState >= 2 && video.currentTime > 0;
      const slow = slowDevice({ saveData: conn.saveData, hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory, frameTimes });
      const quick = reducedMotion || !printable;
      root.dataset.ending = quick ? 'fade' : slow ? 'slide' : 'peel';
      const sheet = root.querySelector('.intro-sheet'); dimensions(sheet, w, h);
      let snapshot = null, photo = '';
      if (printable) snapshot = freezeFrame(video, w, h, box);
      if (snapshot) {
        // Retain the unpatched frame for the print. Only the large sheet loses its baked mark.
        try { photo = snapshot.canvas.toDataURL('image/jpeg', .88); } catch {}
        sheet.append(snapshot.canvas); video.style.visibility = 'hidden';
      }
      // The video stays in its original parent even if snapshotting failed.
      root.classList.add('is-sequence');
      const layers = [];
      const make = (className, parent = root) => { const el = document.createElement('div'); el.className = className; parent.append(el); layers.push(el); return el; };
      let smiley, eyes;
      if (!quick && !slow) {
        root.dataset.patch = snapshot && eraseMark(snapshot, mark, box) ? 'sampled' : 'unavailable';
        smiley = make('intro-mark'); smiley.innerHTML = MARK; dimensions(smiley, mark.width, mark.height);
        transform(smiley, move(mark.left, mark.top));
        eyes = smiley.querySelector('.intro-eyes');
        // Compositor-only blink during the frozen hold; no second JS frame loop.
        eyes.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.08)', offset: .45 },
          { transform: 'scaleY(1)' }], { duration: 220 });
      }
      const frozenAt = performance.now();
      // Ready is bounded exactly as before. All motion starts only after handover and two painted frames.
      await Promise.all([Promise.race([ready, wait(2500)]), wait(quick ? 0 : 250)]);
      if (cleaned) return;
      handover();
      const target = !app && document.getElementById('ld-hero-print');
      const targetRect = target?.getBoundingClientRect();
      const targetImage = target?.querySelector('img');
      const imageRect = targetImage?.getBoundingClientRect();
      const tr = targetRect?.width && imageRect?.width ? imageRect : null;
      const imageWidth = targetImage?.offsetWidth || 0, imageHeight = targetImage?.offsetHeight || 0;
      const targetMatrix = target ? new DOMMatrix(getComputedStyle(target).transform) : null;
      const targetAngle = targetMatrix ? Math.atan2(targetMatrix.b, targetMatrix.a) * 180 / Math.PI : 0;
      // Preserve the original photo's aspect ratio when swapping its pixels (no layout shift).
      if (targetImage && imageWidth && imageHeight) {
        targetImage.style.aspectRatio = `${imageWidth} / ${imageHeight}`;
        targetImage.style.objectFit = 'cover';
      }
      const start = { left: -w * .16, top: -h * .14, width: Math.min(w * .32, 360), height: Math.min(w * .32, 360) * box.height / box.width };
      const end = tr ? { left: tr.left + tr.width / 2 - imageWidth / 2,
        top: tr.top + tr.height / 2 - imageHeight / 2, width: imageWidth, height: imageHeight } :
        { left: -w * .5, top: -h * .6, width: start.width * .2, height: start.height * .2 };
      if (quick) root.classList.add('is-quick', 'is-welcome');
      let front, backClip, back, shadow, fold, flight, cat, dots = [];
      const catHeight = Math.min(160, w * .28) * 339 / 360; // stands on the smiley's ground, above the stamp
      const size = Math.max(40, Math.min(76, w * .14));
      const corner = { x: w - size - 12, y: h - size * 380 / 320 - 12 };
      const centre = { x: w / 2 - size / 2, y: h * .5 - size * 380 / 640 };
      if (!quick && !slow) {
        front = sheet.parentElement; layers.push(front);
        backClip = make('intro-clip'); back = make('intro-back', backClip); dimensions(back, w, h);
        shadow = make('intro-shadow'); fold = make('intro-fold');
        const g = foldGeometry(w, h, 0);
        for (const clip of [front, backClip]) dimensions(clip, g.size, g.size * 2);
        dimensions(shadow, 100, g.size * 2); dimensions(fold, 28, g.size * 2);
        for (const el of [backClip, shadow, fold]) opacity(el, 0);
        root.append(smiley); // above the sheet and its curl
        for (let i = 0; i < 18; i++) dots.push(make('intro-dot'));
        cat = !app && document.createElement('img');
        if (cat) { cat.className = 'intro-cat'; cat.src = 'media/ticket/cat-bat.webp'; cat.alt = ''; dimensions(cat, Math.min(160, w * .28), Math.min(160, w * .28) * 339 / 360); opacity(cat, 0); root.append(cat); layers.push(cat); }
      }
      if (!quick && !slow) {
        // Only the film's picture flies: the letterbox bars stay behind, so portrait phones don't squash it.
        flight = make('intro-flight'); dimensions(flight, box.width, box.height); flight.style.overflow = 'hidden';
        if (snapshot) {
          const copy = snapshot.canvas.cloneNode(); copy.getContext('2d').drawImage(snapshot.canvas, 0, 0);
          dimensions(copy, w, h); copy.style.cssText += `;position:absolute;left:${-box.left}px;top:${-box.top}px`;
          flight.append(copy);
        }
        opacity(flight, 0);
      }
      for (const el of [sheet, card, ...layers]) el.style.willChange = 'transform, opacity';
      let painted = 0, started = 0, photoSet = false;
      const cues = new Set();
      const cue = (at, time, name) => { if (time >= at && !cues.has(at)) { cues.add(at); playSound(name); } };
      await new Promise(resolve => {
        resolveSequence = resolve;
        const tick = now => {
          if (cleaned) return;
          try {
            if (++painted <= 2) { raf = requestAnimationFrame(tick); return; }
            if (!started) started = now;
            const t = now - started;
            const endTime = quick ? 1000 : slow ? 1250 : 3300;
            if (quick) {
              opacity(sheet, 1 - segment(t, 0, 220));
              opacity(card, 1 - segment(t, 750, 250));
              transform(card, 'translate(-50%,-50%) rotate(-3deg)');
              land();
            } else if (slow) {
              transform(sheet, `${move(-w * out(segment(t, 0, 430)), -h * .12 * segment(t, 0, 430))} rotate(-3deg)`);
              opacity(sheet, 1 - segment(t, 280, 150));
              if (!root.classList.contains('is-welcome')) root.classList.add('is-welcome');
              transform(card, `translate(-50%,-50%) rotate(-4deg) scale(${mix(1.3, 1, out(segment(t, 330, 160)))})`);
              opacity(card, segment(t, 330, 80) * (1 - segment(t, 950, 300)));
              cue(430, t, 'stamp');
              if (t >= 430) land();
            } else {
              const hop = segment(t, 0, 600), half = Math.min(1, Math.floor(hop * 2)), arc = hop === 1 ? 1 : hop * 2 - half;
              const travel = ease(hop);
              const x = mix(mark.left, corner.x, travel), y = mix(mark.top, corner.y, travel) - Math.sin(arc * Math.PI) * Math.min(h * .2, 145);
              const k = mix(1, size / mark.width, travel);
              const p = ease(segment(t, 600, 800)), g = foldGeometry(w, h, p);
              const outer = `${move(g.x, g.y)} rotate(${g.angle}deg)`;
              const inverse = `rotate(${-g.angle}deg) ${move(-g.x, -g.y)}`;
              transform(front, outer); transform(sheet, inverse);
              transform(backClip, outer);
              transform(back, `${inverse} matrix(${g.reflection.join(',')})`);
              opacity(backClip, segment(t, 600, 90) * (1 - segment(t, 1220, 180)));
              const foldX = g.nx * g.distance + g.ny * g.size, foldY = g.ny * g.distance - g.nx * g.size;
              transform(shadow, `${move(foldX - g.nx * 45, foldY - g.ny * 45)} rotate(${g.angle}deg)`);
              transform(fold, `${move(foldX - g.nx * 16, foldY - g.ny * 16)} rotate(${g.angle}deg)`);
              const foldOpacity = segment(t, 600, 80) * (1 - segment(t, 1300, 100));
              opacity(shadow, foldOpacity); opacity(fold, foldOpacity);
              opacity(front, 1 - segment(t, 1380, 20));
              for (let i = 0; i < dots.length; i++) {
                const when = (i + 1) / (dots.length + 1), d = ease(when), a = (when * 2) % 1;
                transform(dots[i], move(mix(mark.left, corner.x, d) + size / 2,
                  mix(mark.top, corner.y, d) - Math.sin(a * Math.PI) * Math.min(h * .2, 145) + size / 2));
                opacity(dots[i], hop >= when ? 1 - segment(t, 650 + i * 6, 180) : 0);
              }
              let sx = x, sy = y, sk = k, rotation = Math.sin(hop * Math.PI * 4) * 12;
              if (t >= 600 && t < 1400) {
                const pull = segment(t, 600, 800);
                sx = mix(corner.x, -size * .3, ease(pull)); sy = mix(corner.y, -size * .3, ease(pull));
                sk = size / mark.width; rotation = -24 * Math.sin(pull * Math.PI);
              } else if (t >= 1400) {
                const drop = segment(t, 1400, 440);
                sx = mix(-size * .3, centre.x, out(drop)); sy = mix(-size * .3, centre.y, drop * drop);
                sk = size / mark.width; rotation = 0;
                // Two diminishing bounces, then the rubber stamp hits the page.
                if (t >= 1840) sy = centre.y - Math.abs(Math.sin(segment(t, 1840, 300) * Math.PI * 2)) * 32 * (1 - segment(t, 1840, 300));
                if (t >= 2900) {
                  const exit = segment(t, 2900, 300);
                  if (app) { sx += (w + size) * exit; sy -= Math.sin(exit * Math.PI) * h * .25; rotation = Math.sin(exit * Math.PI) * 18; }
                  else { sx -= (w + size) * exit; sy -= h * .6 * exit; rotation = -exit * 320; }
                }
              }
              transform(smiley, `${move(sx, sy)} rotate(${rotation.toFixed(2)}deg) scale(${sk.toFixed(5)})`);
              cue(0, t, 'wheel-thunk'); cue(300, t, 'wheel-thunk'); cue(600, t, 'tear');
              cue(1840, t, 'wheel-thunk'); cue(1990, t, 'wheel-thunk'); cue(2140, t, 'stamp');
              if (t >= 2140 && !root.classList.contains('is-welcome')) root.classList.add('is-welcome');
              const stamp = out(segment(t, 2060, 80));
              const shake = Math.sin(segment(t, 2140, 120) * Math.PI * 4) * 3 * (1 - segment(t, 2140, 120));
              transform(card, `translate(calc(-50% + ${shake.toFixed(2)}px),-50%) rotate(-5deg) scale(${mix(1.65, 1, stamp).toFixed(4)})`);
              opacity(card, segment(t, 2060, 80) * (1 - segment(t, 3000, 280)));
              if (cat) {
                const walk = out(segment(t, 2280, 320)), leave = segment(t, 3000, 280);
                transform(cat, `${move(mix(w + 180, centre.x + size * .65, walk) + (w + 180) * leave,
                  centre.y + size * 380 / 320 - catHeight - Math.abs(Math.sin(walk * Math.PI * 5)) * 4)} rotate(${t >= 2900 && t < 3000 ? -18 : 0}deg)`);
                opacity(cat, segment(t, 2280, 30) * (1 - leave));
                cue(2900, t, 'flap'); // 300ms stare, then a swat
              } else cue(2900, t, 'wheel-thunk');
            }
            if (!quick && !slow) {
              // FLIP: one measured target, all subsequent frames use transforms only.
              const p = ease(segment(t, 1280, 500));
              const r = { left: mix(start.left, end.left, p), top: mix(start.top, end.top, p),
                width: mix(start.width, end.width, p), height: mix(start.height, end.height, p) };
              transform(flight, `${move(r.left + r.width / 2, r.top + r.height / 2)} rotate(${(targetAngle * p).toFixed(3)}deg) scale(${(r.width / box.width).toFixed(6)},${(r.height / box.height).toFixed(6)}) ${move(-box.width / 2, -box.height / 2)}`);
              opacity(flight, segment(t, 1280, 100) * (1 - segment(t, 1780, tr ? 160 : 20)));
              if (t >= 1780) {
                if (!photoSet && photo && targetImage) { targetImage.src = photo; photoSet = true; }
                cue(1780, t, 'paper-drop'); land();
              }
            }
            if (t >= endTime || now - frozenAt >= SEQUENCE_LIMIT - 100) { cleanup(); return; }
            raf = requestAnimationFrame(tick);
          } catch { cleanup(); }
        };
        raf = requestAnimationFrame(tick);
      });
    } catch { cleanup(); }
  });

  if (!filmAllowed({ reducedMotion, saveData: conn.saveData, effectiveType: conn.effectiveType })) return finish(false);
  video.src = filmSource({ width: innerWidth, height: innerHeight, saveData: conn.saveData, downlink: conn.downlink, effectiveType: conn.effectiveType });
  video.addEventListener('ended', () => finish(true));
  video.addEventListener('error', () => finish(false));
  video.addEventListener('playing', () => { played = true; preloadSound(); });
  video.load();
  if (!(await buffered(video))) return finish(false);
  if (done) return;
  await visible();
  if (done) return;
  try { await video.play(); } catch {
    if (done) return;
    video.muted = true;
    try { await video.play(); } catch { return finish(false); }
    if (!done) sound.hidden = false;
  }
  if (done) return;
  filmVisibility = () => {
    previousFrame = 0;
    if (document.visibilityState === 'hidden') video.pause();
    else if (!video.ended && !done) video.play().catch(() => {});
  };
  document.addEventListener('visibilitychange', filmVisibility);
  video.addEventListener('pause', () => {
    if (!done && document.visibilityState === 'visible' && !video.ended) video.play().catch(() => {});
  });
  const measure = now => {
    if (done) return;
    if (video.duration - video.currentTime <= MOUNT_LEAD && document.visibilityState === 'visible') {
      if (previousFrame) { frameTimes.push(now - previousFrame); if (frameTimes.length > 120) frameTimes.shift(); }
      previousFrame = now;
    } else previousFrame = 0;
    raf = requestAnimationFrame(measure);
  };
  raf = requestAnimationFrame(measure);
  let lastTime = -1, frozen = 0;
  watchdog = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (video.duration && video.currentTime >= video.duration - MOUNT_LEAD) underneathReady().catch(() => {});
    frozen = video.currentTime === lastTime ? frozen + .5 : 0;
    lastTime = video.currentTime;
    if (frozen >= STALL_LIMIT) finish(false);
  }, 500);
}

function once(fn) {
  let called = false, result;
  return (...args) => { if (!called) { called = true; result = fn(...args); } return result; };
}
