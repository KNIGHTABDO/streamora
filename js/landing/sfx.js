// Landing-only audio. Nothing is constructed or downloaded before unlock().
const names = new Set(['paper-drop', 'paper-slide', 'page-turn', 'card-deal', 'stamp', 'tear', 'wheel-tick', 'wheel-thunk', 'pen', 'projector', 'curtain', 'tick-mark', 'flap', 'room-tone']);
const key = 'streamora:landing-sound';
let enabled = true, unlocked = false, context;
try { enabled = localStorage.getItem(key) !== 'off'; } catch { /* Private browsing. */ }
const buffers = new Map(), starts = new Map(), voices = new Set();
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const saveData = () => globalThis.navigator?.connection?.saveData;

function load(name) {
  if (!context || !unlocked || !names.has(name)) return Promise.resolve(null);
  if (!buffers.has(name)) {
    const ctx = context;
    buffers.set(name, fetch(new URL(`../../media/ticket/sfx/${name}.m4a`, import.meta.url))
      .then(r => r.ok ? r.arrayBuffer() : null)
      .then(bytes => bytes ? ctx.decodeAudioData(bytes) : null)
      .catch(() => null));
  }
  return buffers.get(name);
}

export const sfx = {
  unlock() {
    try {
      if (globalThis.navigator?.userActivation && !navigator.userActivation.isActive && !unlocked) return;
      unlocked = true;
      if (!enabled) return;
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      context ||= new Audio();
      if (document.visibilityState !== 'hidden') context.resume()?.catch(() => {});
    } catch { /* Audio is optional. */ }
  },
  get on() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* Optional persistence. */ }
    if (!enabled) for (const voice of voices) voice.stop(.06);
    else if (unlocked) sfx.unlock();
    return enabled;
  },
  preload(list = []) {
    if (!unlocked || !enabled || saveData()) return;
    try { for (const name of list) void load(name); } catch { /* Never block the page. */ }
  },
  play(name, { vol = 1, rate = 1, pan = 0 } = {}) {
    if (!unlocked || !enabled || !context || !names.has(name) || document.visibilityState === 'hidden') return;
    let cancelled = false, source, gain;
    const voice = {
      stop(fade = .12) {
        cancelled = true;
        voices.delete(voice);
        try {
          if (!source) return;
          const now = context.currentTime, duration = clamp(fade, 0, 2);
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + duration);
          source.stop(now + duration + .01);
        } catch { /* Already stopped. */ }
      },
    };
    voices.add(voice);
    void load(name).then(buffer => {
      if (!buffer || cancelled || !enabled || document.visibilityState === 'hidden') { voices.delete(voice); return; }
      try {
        const now = context.currentTime;
        if (now - (starts.get(name) ?? -Infinity) < .04) { voices.delete(voice); return; }
        starts.set(name, now);
        source = context.createBufferSource();
        gain = context.createGain();
        source.buffer = buffer;
        source.loop = name === 'projector' || name === 'room-tone';
        source.playbackRate.value = clamp(rate, .25, 3) * (1 + (Math.random() * .08 - .04));
        gain.gain.value = clamp(vol, 0, 1);
        source.connect(gain);
        if (context.createStereoPanner) {
          const stereo = context.createStereoPanner();
          stereo.pan.value = clamp(pan, -1, 1);
          gain.connect(stereo).connect(context.destination);
          source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); stereo.disconnect(); };
        } else {
          gain.connect(context.destination);
          source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
        }
        source.start();
      } catch { voice.stop(0); }
    }).catch(() => voice.stop(0));
    return voice;
  },
};

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  try {
    if (document.visibilityState === 'hidden') {
      for (const voice of voices) voice.stop(0);
      context?.suspend()?.catch(() => {});
    } else if (enabled && unlocked) context?.resume()?.catch(() => {});
  } catch { /* A closed context must not affect the page. */ }
}, { passive: true });
