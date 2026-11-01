// Keep this small copy in step with discover-lists.js; landing-moods.test.js guards it.
export const LANDING_MOODS = Object.freeze([
  { id: 'cozy', label: 'Cozy' },
  { id: 'mind', label: 'Mind-Bending' },
  { id: 'cry', label: 'Cry It Out' },
  { id: 'adrenaline', label: 'Adrenaline' },
  { id: 'comfort', label: 'Comfort Rewatch' },
  { id: 'date', label: 'Date Night' },
  { id: 'weird', label: '3AM Weird' },
  { id: 'lol', label: 'Laugh Out Loud' },
].map(Object.freeze));

let instance = 0;
const SEG = 45;
const polar = (angle, radius) => [240 + Math.sin(angle * Math.PI / 180) * radius, 240 - Math.cos(angle * Math.PI / 180) * radius];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const normalize = a => ((a % 360) + 360) % 360;
const colors = ['#c9a35e', '#8c9690', '#b77e76', '#b25f43', '#879279', '#c18f81', '#7a7e90', '#b8a465'];
const symbols = ['☼', '✧', '♡', 'ϟ', '↺', '♥', '☾', '☺'];

export function initWheel(el, { sfx, onSettle = () => {}, onPrint = () => {} } = {}) {
  const uid = `lp-wheel-${++instance}`;
  const wedges = LANDING_MOODS.map((m, i) => {
    const [x0, y0] = polar(i * SEG - SEG / 2, 212), [x1, y1] = polar(i * SEG + SEG / 2, 212);
    const lines = m.label === 'Comfort Rewatch' ? ['Comfort', 'Rewatch'] : m.label === 'Laugh Out Loud' ? ['Laugh Out', 'Loud'] : m.label === 'Mind-Bending' ? ['Mind-', 'Bending'] : [m.label];
    return `<path d="M240 240L${x0} ${y0}A212 212 0 0 1 ${x1} ${y1}Z" fill="${colors[i]}" stroke="#6b5137" stroke-width="1"/>
      <g transform="rotate(${i * SEG} 240 240)"><text class="lp-wheel-label" x="240" y="86">${lines.map((line, j) => `<tspan x="240" dy="${j ? 19 : 0}">${line}</tspan>`).join('')}</text>
      <text class="lp-wheel-symbol" x="240" y="164">${symbols[i]}</text>
      <image class="lp-wheel-image" href="/media/ticket/mood-${m.id}.webp" x="215" y="121" width="50" height="50" preserveAspectRatio="xMidYMid meet" opacity="0"/></g>`;
  }).join('');
  const ticks = Array.from({ length: 120 }, (_, i) => {
    const [x1, y1] = polar(i * 3, i % 5 ? 218 : 215), [x2, y2] = polar(i * 3, 223);
    return `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
  }).join('');
  el.classList.add('lp-wheel');
  el.innerHTML = `<div class="lp-wheel-machine"><div class="lp-wheel-dial" role="slider" tabindex="0" aria-label="Mood wheel" aria-valuemin="1" aria-valuemax="8" aria-valuenow="1" aria-valuetext="Cozy" aria-describedby="${uid}-help">
    <div class="lp-wheel-window"><div class="lp-wheel-rotor"><svg class="lp-wheel-art" viewBox="0 0 480 480" aria-hidden="true"><defs>
      <radialGradient id="${uid}-brass" cx="34%" cy="26%"><stop stop-color="#e5c580"/><stop offset=".62" stop-color="#b08a45"/><stop offset=".88" stop-color="#7f592a"/><stop offset="1" stop-color="#c6a264"/></radialGradient>
      <pattern id="${uid}-grain" width="11" height="13" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".65" fill="#3f2915" opacity=".23"/><circle cx="8" cy="9" r=".8" fill="#fff2cf" opacity=".3"/><path d="M0 11l4-1M7 2h2" stroke="#382514" stroke-width=".4" opacity=".2"/></pattern>
    </defs><circle cx="240" cy="240" r="232" fill="url(#${uid}-brass)" stroke="#5d4023" stroke-width="2"/>
    <circle cx="240" cy="240" r="225" fill="none" stroke="#654925"/><circle cx="240" cy="240" r="213" fill="none" stroke="#ecd39e" stroke-width="3"/>
    ${wedges}<circle cx="240" cy="240" r="224" fill="url(#${uid}-grain)" pointer-events="none"/>
    <g stroke="#624627" stroke-width="1">${ticks}</g><circle cx="240" cy="240" r="229" fill="none" stroke="#e4c07b"/>
    </svg></div></div><span class="lp-wheel-pointer" aria-hidden="true"></span><span class="lp-wheel-hub" aria-hidden="true">S</span>
    </div><div class="lp-wheel-slot" aria-hidden="true"></div><div class="lp-wheel-ticket-pocket"><div class="lp-wheel-ticket" role="status" aria-live="polite" aria-atomic="true"></div></div></div>
    <p class="lp-wheel-help" id="${uid}-help">Drag the brass wheel. Arrow keys choose a feeling; Enter spins.</p>`;
  const dial = el.querySelector('.lp-wheel-dial'), rotor = el.querySelector('.lp-wheel-rotor');
  const pointer = el.querySelector('.lp-wheel-pointer'), ticket = el.querySelector('.lp-wheel-ticket');
  const removers = [], animations = new Set();
  const listen = (node, name, fn, passive = true) => {
    node.addEventListener(name, fn, { passive });
    removers.push(() => node.removeEventListener(name, fn));
  };
  el.querySelectorAll('.lp-wheel-image').forEach(img => {
    listen(img, 'load', () => { img.setAttribute('opacity', '1'); img.previousElementSibling.setAttribute('opacity', '0'); });
    listen(img, 'error', () => { img.removeAttribute('href'); });
  });
  let angle = 0, velocity = 0, frame = 0, previousTime = 0, target = null, dead = false;
  let drag = null, touchedAt = -Infinity, touchedY = 0, serial = 0, pointerAnimation;
  const index = () => normalize(Math.round(-angle / SEG) * SEG) / SEG;
  const animate = (node, frames, options) => {
    const a = node.animate(frames, options); animations.add(a);
    a.finished.then(() => animations.delete(a), () => animations.delete(a)); return a;
  };
  function draw(next, speed = 0, audible = true) {
    const boundary = Math.floor((angle + SEG / 2) / SEG);
    angle = next;
    rotor.style.transform = `rotate(${angle}deg)`;
    const m = LANDING_MOODS[index()];
    dial.setAttribute('aria-valuenow', String(index() + 1));
    dial.setAttribute('aria-valuetext', m.label);
    if (Math.floor((angle + SEG / 2) / SEG) !== boundary && audible) {
      sfx?.play('wheel-tick', { vol: .3, rate: 1 + Math.min(Math.abs(speed), 1) * .15 });
      if (!reduced()) {
        pointerAnimation?.cancel();
        const flick = Math.sign(speed || 1) * Math.min(24, 6 + Math.abs(speed) * 16);
        pointerAnimation = animate(pointer, [{ transform: 'rotate(0deg)' }, { transform: `rotate(${flick}deg)`, offset: .22 }, { transform: 'rotate(-3deg)', offset: .62 }, { transform: 'rotate(0deg)' }], { duration: 180, easing: 'ease-out' });
      }
    }
  }
  function settle() {
    frame = 0; velocity = 0; target = null;
    draw(Math.round(angle / SEG) * SEG, 0, false);
    // Keep accumulated turns bounded after a gesture, never during a drag.
    angle = normalize(angle); rotor.style.transform = `rotate(${angle}deg)`;
    const mood = LANDING_MOODS[index()];
    sfx?.play('wheel-thunk', { vol: .5 });
    onSettle(mood);
    ticket.innerHTML = `<span class="lp-ticket-admit">ADMIT ONE</span><strong class="lp-ticket-mood">${mood.label}</strong><span class="lp-ticket-meta">No. ${String(++serial).padStart(6, '0')} · ${new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</span><span class="lp-ticket-wait">Waiting inside.</span>`;
    ticket.classList.add('lp-wheel-ticket-printed');
    if (!reduced()) animate(ticket, [{ transform: 'translateY(-104%) rotate(-2deg)' }, { transform: 'translateY(3%) rotate(2deg)', offset: .82 }, { transform: 'translateY(0) rotate(1deg)' }], { duration: 460, easing: 'cubic-bezier(.2,.7,.25,1)' });
    sfx?.play('paper-slide', { vol: .4 });
    onPrint(mood);
  }
  function move(time) {
    if (dead) return;
    if (reduced()) { settle(); return; }
    const dt = Math.min(32, Math.max(1, time - previousTime)); previousTime = time;
    if (target === null && Math.abs(velocity) > .055) {
      velocity *= Math.exp(-dt / 280);
      draw(angle + velocity * dt, velocity);
    } else {
      target ??= Math.round(angle / SEG) * SEG;
      const delta = target - angle;
      if (Math.abs(delta) < .12) { draw(target, 0, false); settle(); return; }
      draw(angle + delta * (1 - Math.exp(-dt / 70)), delta / 70);
    }
    frame = requestAnimationFrame(move);
  }
  function start() {
    cancelAnimationFrame(frame); frame = 0;
    if (reduced()) { if (target !== null) draw(target, 0, false); settle(); return; }
    previousTime = performance.now(); frame = requestAnimationFrame(move);
  }
  function touch() { touchedAt = performance.now(); touchedY = window.scrollY; }
  const bearing = (x, y, center) => Math.atan2(y - center.y, x - center.x) * 180 / Math.PI;
  listen(dial, 'pointerdown', e => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    sfx?.unlock(); touch(); cancelAnimationFrame(frame); frame = 0; velocity = 0; target = null;
    const box = dial.getBoundingClientRect(), center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    drag = { id: e.pointerId, center, bearing: bearing(e.clientX, e.clientY, center), time: performance.now(), moved: false };
    dial.setPointerCapture(e.pointerId); dial.classList.add('lp-wheel-dragging');
  });
  listen(dial, 'pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const now = performance.now(), b = bearing(e.clientX, e.clientY, drag.center);
    const delta = ((b - drag.bearing + 540) % 360) - 180;
    if (Math.hypot(e.clientX - drag.center.x, e.clientY - drag.center.y) < 28) return;
    velocity = Math.max(-1.7, Math.min(1.7, delta / Math.max(8, now - drag.time)));
    drag.moved ||= Math.abs(delta) > 1;
    draw(angle + delta, velocity, !reduced()); drag.bearing = b; drag.time = now;
  });
  function release(e) {
    if (!drag || drag.id !== e.pointerId) return;
    if (performance.now() - drag.time > 90 || e.type === 'pointercancel') velocity = 0;
    const moved = drag.moved; drag = null; touch();
    if (dial.hasPointerCapture(e.pointerId)) dial.releasePointerCapture(e.pointerId);
    dial.classList.remove('lp-wheel-dragging');
    if (!moved && e.type !== 'pointercancel') spin(); else start();
  }
  listen(dial, 'pointerup', release); listen(dial, 'pointercancel', release);
  function spin() {
    touch(); target = null;
    if (reduced()) { draw(-Math.floor(Math.random() * 8) * SEG, 0, false); settle(); }
    else { velocity = 1 + Math.random() * .65; start(); }
  }
  listen(dial, 'keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); sfx?.unlock(); touch();
    if (e.key === 'Enter' || e.key === ' ') { spin(); return; }
    const step = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? 1 : -1;
    target = e.key === 'Home' ? 0 : e.key === 'End' ? -7 * SEG : (target ?? Math.round(angle / SEG) * SEG) + step * SEG;
    velocity = 0; start();
  }, false);
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  listen(motionQuery, 'change', () => {
    if (!motionQuery.matches) return;
    animations.forEach(a => a.cancel());
    if (frame) { cancelAnimationFrame(frame); settle(); }
  });
  listen(document, 'visibilitychange', () => { if (document.hidden && frame) { cancelAnimationFrame(frame); settle(); } });
  return {
    setProgress(p) {
      if (dead || drag || frame || (performance.now() - touchedAt < 3000 && Math.abs(window.scrollY - touchedY) <= 400)) return;
      if (!Number.isFinite(p)) return;
      const next = reduced() ? Math.round(Math.max(0, Math.min(1, p)) * 8) * SEG : Math.max(0, Math.min(1, p)) * 360;
      draw(next, (next - angle) / 16);
    },
    destroy() {
      dead = true; cancelAnimationFrame(frame); animations.forEach(a => a.cancel()); removers.forEach(fn => fn());
      if (drag && dial.hasPointerCapture(drag.id)) dial.releasePointerCapture(drag.id);
      el.replaceChildren(); el.classList.remove('lp-wheel');
    },
  };
}
