// Loaded only by the inline boot gate or Settings → About.
import { redact, copyText } from './diag.js';

/** A URL opt-out wins over both URL opt-ins and the persistent preference. No storage writes here. */
export function gate({ search = '', hash = '', stored } = {}) {
  const flags = (search + '&' + hash.slice(hash.indexOf('?'))).match(/[?&]perf=[01](?=&|$)/g) || [];
  return !flags.some(s => s.endsWith('0')) && (flags.length > 0 || stored === '1');
}

/** User Timing entries for the latest play, in timestamp order (input is never mutated). */
export function playStages(marks) {
  const sorted = marks.filter(m => m.name.startsWith('play:')).slice().sort((a, b) => a.startTime - b.startTime);
  let start = -1;
  sorted.forEach((m, i) => { if (m.name === 'play:tap') start = i; });
  if (start < 0) return [];
  const tap = sorted[start].startTime;
  let previous = tap;
  let checked = false;
  return sorted.slice(start).filter(m => {
    // Parallel batches can answer more than once; this milestone means the first answer.
    if (m.name !== 'play:checkcached') return true;
    if (checked) return false;
    checked = true; return true;
  }).map(m => {
    const stage = { name: m.name, at: m.startTime - tap, dur: m.startTime - previous };
    previous = m.startTime;
    return stage;
  });
}

/** Nearest-rank p75 of observed interaction durations; worst five, descending. */
export function inpSummary(durations) {
  const sorted = durations.filter(n => Number.isFinite(n) && n >= 0).slice().sort((a, b) => a - b);
  return { p75: sorted.length ? sorted[Math.ceil(sorted.length * .75) - 1] : 0, worst: sorted.slice(-5).reverse() };
}

let card, style, timer, resetAt = -Infinity;
let expanded = false;
let observers = [];
let lcp = null, cls = 0, longtask = 0, loaf = 0;
const interactions = new Map();
const seen = new Set();
const launchNames = ['boot:gate', 'boot:css', 'boot:main', 'shell', 'home:row1', 'home:poster1', 'home:hero'];
const ms = n => n == null ? '—' : `${Math.round(n)} ms`;

function targetName(el) {
  if (!el?.tagName) return '';
  // Keep no text, attribute values, URLs or ancestor paths.
  return (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.classList?.length ? '.' + el.classList[0] : '')).slice(0, 80);
}

function collect(type, entries) {
  for (const e of entries) {
    if (e.startTime < resetAt) continue;
    const key = `${type}:${e.startTime}:${e.duration}:${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === 'largest-contentful-paint') lcp = e.startTime;
    if (type === 'layout-shift' && !e.hadRecentInput) cls += e.value;
    if (type === 'longtask') longtask += e.duration;
    if (type === 'long-animation-frame') loaf += e.duration;
    // A click can generate several Event Timing entries; INP counts the interaction once.
    if (type === 'event' && e.interactionId) {
      const previous = interactions.get(e.interactionId);
      if (!previous || previous.duration < e.duration) interactions.set(e.interactionId,
        { duration: e.duration, target: targetName(e.target) });
    }
  }
}

function observe(type) {
  if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) return;
  try {
    const observer = new PerformanceObserver(list => collect(type, list.getEntries()));
    observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 40 } : {}) });
    observers.push(observer);
  } catch { /* Older Safari may advertise a type but reject its observe options. */ }
}

function report() {
  const marks = performance.getEntriesByType('mark');
  const nav = performance.getEntriesByType('navigation')[0];
  const inp = inpSummary([...interactions.values()].map(e => e.duration));
  const worst = [...interactions.values()].sort((a, b) => b.duration - a.duration).slice(0, 5);
  return {
    launch: Object.fromEntries(launchNames.map(name => [name, marks.find(m => m.name === name)?.startTime ?? null])),
    pages: marks.filter(m => m.name.startsWith('page:')).map(m => ({ name: m.name, at: m.startTime })),
    lcp, cls, longtask, longAnimationFrame: loaf, inp: { ...inp, targets: worst },
    memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null,
    sw: { controlled: !!navigator.serviceWorker?.controller, zeroTransfer: nav ? nav.transferSize === 0 : null, deliveryType: nav?.deliveryType || '' },
    play: playStages(marks),
  };
}

function node(tag, text, clsName) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (clsName) el.className = clsName;
  return el;
}

function refresh() {
  if (!card) return;
  const data = report();
  const metrics = card.querySelector('.perf-metrics');
  const sw = data.sw;
  metrics.textContent = [
    ...Object.entries(data.launch).map(([name, at]) => `${name}: ${ms(at)}`),
    `LCP: ${ms(data.lcp)} · CLS: ${data.cls.toFixed(3)}`,
    `Long tasks: ${ms(data.longtask)} · Long frames: ${ms(data.longAnimationFrame)}`,
    `INP p75: ${ms(data.inp.p75)} · worst: ${data.inp.worst.map(ms).join(', ') || '—'}`,
    ...data.inp.targets.map(e => `  ${ms(e.duration)} ${e.target}`),
    `SW: ${sw.controlled ? 'controlled' : 'uncontrolled'} · transferSize=0: ${sw.zeroTransfer == null ? 'unknown' : sw.zeroTransfer ? 'yes' : 'no'}${sw.deliveryType ? ' · ' + sw.deliveryType : ''}`,
    ...(data.memory ? [`Heap: ${(data.memory.used / 1048576).toFixed(1)} / ${(data.memory.total / 1048576).toFixed(1)} MB`] : []),
  ].join('\n');
  const waterfall = card.querySelector('.perf-waterfall');
  waterfall.hidden = !expanded;
  // Replacing only non-interactive content keeps keyboard focus on the controls.
  waterfall.replaceChildren();
  if (!expanded) return;
  if (!data.play.length) { waterfall.textContent = 'Play a title to see its stages.'; return; }
  const total = Math.max(1, ...data.play.map(s => s.at));
  for (const stage of data.play) {
    const row = node('div', null, 'perf-stage');
    row.append(node('span', `${stage.name} · ${ms(stage.at)} (+${ms(stage.dur)})`));
    const track = node('div', null, 'perf-track');
    const bar = node('i');
    bar.style.marginLeft = `${(stage.at - stage.dur) / total * 100}%`;
    bar.style.width = `${stage.dur / total * 100}%`;
    track.append(bar); row.append(track); waterfall.append(row);
  }
}

function clear() {
  // Drop queued observer records as well as already-delivered entries.
  for (const observer of observers) observer.takeRecords();
  resetAt = performance.now();
  performance.clearMarks();
  lcp = null; cls = longtask = loaf = 0;
  interactions.clear(); seen.clear();
  refresh();
}

export function start() {
  if (card) return;
  if (window.__streamora) window.__streamora.perf = true;
  style = node('style', `
.streamora-perf { position: fixed; z-index: 10000; left: max(8px, env(safe-area-inset-left)); bottom: calc(var(--tab-h, 64px) + env(safe-area-inset-bottom, 0px) + 10px); width: min(340px, calc(100vw - 24px)); box-sizing: border-box; max-height: 65vh; overflow: auto; padding: 10px; background: var(--paper, #f3e6cf); color: var(--ink, #241c28); border: 2px solid var(--line, #241c28); border-radius: 9px 5px 11px 6px; box-shadow: var(--shadow, 3px 3px 0 #241c28); font: 11px/1.45 ui-monospace, monospace; }
.streamora-perf button { font: inherit; color: inherit; background: var(--paper-2, #e8d8bb); border: 1px solid var(--line, #241c28); border-radius: 4px; padding: 6px 8px; cursor: pointer; min-height: 32px; }
.streamora-perf button:focus-visible { outline: 2px solid var(--a1, #a33); outline-offset: 2px; }
.perf-head, .perf-actions { display: flex; gap: 6px; align-items: center; }
.perf-head { justify-content: space-between; margin-bottom: 6px; }
.perf-metrics { white-space: pre-wrap; overflow-wrap: anywhere; }
.perf-actions { margin-top: 8px; }
.perf-stage { margin-top: 8px; overflow-wrap: anywhere; }
.perf-track { height: 5px; background: var(--paper-3, #e0cba4); }
.perf-track i { display: block; height: 100%; min-width: 1px; background: var(--ink, #241c28); }
@media (min-width: 761px) { .streamora-perf { bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); } }
`);
  document.head.append(style);
  card = node('aside', null, 'streamora-perf');
  card.setAttribute('aria-label', 'Speed overlay');
  const head = node('div', null, 'perf-head');
  const toggle = node('button', 'Speed · stages ▾');
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(expanded));
  toggle.onclick = () => { expanded = !expanded; toggle.setAttribute('aria-expanded', String(expanded)); refresh(); };
  const close = node('button', '×');
  close.type = 'button'; close.setAttribute('aria-label', 'Hide speed overlay'); close.onclick = stop;
  head.append(toggle, close);
  const actions = node('div', null, 'perf-actions');
  const copy = node('button', 'Copy JSON'); copy.type = 'button';
  copy.onclick = async () => { copy.textContent = await copyText(redact(JSON.stringify(report(), null, 2))) ? 'Copied' : 'Copy failed'; };
  const reset = node('button', 'Reset'); reset.type = 'button'; reset.onclick = clear;
  actions.append(copy, reset);
  card.append(head, node('div', null, 'perf-metrics'), node('div', null, 'perf-waterfall'), actions);
  document.body.append(card);
  for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask', 'long-animation-frame', 'event']) observe(type);
  refresh();
  timer = setInterval(() => { if (!document.hidden) refresh(); }, 1000);
}

export function stop() {
  if (window.__streamora) window.__streamora.perf = false;
  clearInterval(timer); timer = null;
  for (const observer of observers) observer.disconnect();
  observers = [];
  card?.remove(); style?.remove(); card = style = null;
}
