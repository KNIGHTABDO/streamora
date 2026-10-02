// In the iPhone/iPad app, the web player can run on VLC instead of <video>: VLC draws the picture natively *behind*
// the (then transparent) page and the player's own controls stay on top. VlcVideo looks enough like an
// HTMLMediaElement (currentTime, paused, events…) that player.js barely notices. See VlcEngine.swift.
// Engine events come ~4×/s; currentTime is interpolated in between so the seek bar and subtitles stay smooth.

const plugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StreamoraPlayer) || null;

let caps = null;
/** true when this app build has the VLC engine (older .ipa builds only have the classic full-screen player). */
export function vlcEngineAvailable() {
  const p = plugin();
  if (!p || !(window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return Promise.resolve(false);
  caps = caps || Promise.race([p.capabilities().then(c => !!(c && c.engine), () => false), new Promise(r => setTimeout(() => r(false), 1500))]);
  return caps;
}

const EMPTY_RANGES = { length: 0, start: () => 0, end: () => 0 };

export class VlcVideo extends EventTarget {
  constructor(p = plugin()) {
    super();
    this.p = p;
    this._t = 0; this._at = 0; this._dur = 0; this._rate = 1; this._vol = 1; this._muted = false;
    this._want = false;        // play intent (what `paused` reports)
    this._moving = false;      // the picture is actually advancing
    this._seekTo = null; this._seekAt = 0;
    this._cmdAt = 0;           // last play/pause command (VLC takes a moment to follow)
    this.ended = false; this.seeking = false; this.readyState = 0;
    this.videoWidth = 0; this.videoHeight = 0;
    this.textTracks = [];
    this.tracks = { audio: [], subs: [], audioId: -1, subId: -1 };
    this.handles = [];
    this.closed = false;
  }
  fire(type, detail) { this.dispatchEvent(detail ? new CustomEvent(type, { detail }) : new Event(type)); }

  // ---- HTMLMediaElement-ish surface used by player.js
  get currentTime() {
    const extra = this._moving && this._at ? Math.min(1.5, (performance.now() - this._at) / 1000) * this._rate : 0;
    return Math.max(0, this._seekTo != null ? this._seekTo : this._t + extra);
  }
  set currentTime(x) {
    x = Math.max(0, +x || 0);
    this._seekTo = x; this._seekAt = performance.now();
    this.seeking = true; this.ended = false;
    this.p.engineSeek({ time: x }).catch(() => {});
    this.fire('seeking'); this.fire('timeupdate');
  }
  get duration() { return this._dur || NaN; }
  get paused() { return !this._want; }
  get playbackRate() { return this._rate; }
  set playbackRate(r) { this._rate = +r || 1; this.p.engineRate({ rate: this._rate }).catch(() => {}); this.fire('ratechange'); }
  get volume() { return this._vol; }
  set volume(v) { this._vol = Math.max(0, Math.min(1, +v)); this.p.engineVolume({ volume: this._vol, muted: this._muted }).catch(() => {}); this.fire('volumechange'); }
  get muted() { return this._muted; }
  set muted(m) { this._muted = !!m; this.p.engineVolume({ volume: this._vol, muted: this._muted }).catch(() => {}); this.fire('volumechange'); }
  get buffered() { return EMPTY_RANGES; }
  play() {
    if (this.ended) { this.ended = false; this.currentTime = 0; }
    if (!this._want) { this._want = true; this._cmdAt = performance.now(); this.p.enginePlay().catch(() => {}); this.fire('play'); }
    return Promise.resolve();
  }
  pause() {
    if (!this._want) return;
    this._want = false; this._moving = false; this._cmdAt = performance.now();
    this.p.enginePause().catch(() => {});
    this.fire('pause');
  }
  setAudio(id) { this.p.engineAudio({ id }).catch(() => {}); }
  setSub(id) { this.p.engineSub({ id }).catch(() => {}); }

  // ---- lifecycle
  /** Starts playback; resolves to a detach() like engine.attach(). onFatal(err, pos) when the file can't play. */
  async open(url, { start = 0, audioLang = '', onFatal = () => {} } = {}) {
    const p = this.p;
    const on = (name, f) => Promise.resolve(p.addListener(name, f)).then(h => (this.closed ? h.remove() : this.handles.push(h)));
    await on('engine', d => this.onEngine(d, onFatal));
    await on('tracks', d => { this.tracks = d; this.fire('tracks', d); });
    this._t = start; this._want = true; this._cmdAt = performance.now();
    await p.engineOpen({ url, start: Math.max(0, Math.floor(start)), audioLang });
    this.fire('play');
    this.fire('waiting');
    return () => this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.handles.forEach(h => h.remove());
    this.p.engineClose().catch(() => {});
  }

  onEngine(d, onFatal) {
    if (this.closed) return;
    if (d.duration > 0 && d.duration !== this._dur) {
      const first = !this._dur;
      this._dur = d.duration;
      if (first) { this.readyState = 1; this.fire('loadedmetadata'); }
      this.fire('durationchange');
    }
    if (d.width && d.width !== this.videoWidth) { this.videoWidth = d.width; this.videoHeight = d.height; }
    if (d.error) { this.fire('error'); onFatal(new Error(d.error), this.currentTime); return; }

    // a seek is done once VLC reports a time near the target (or after 8 s, whatever it reports)
    if (this._seekTo != null) {
      if (Math.abs(d.time - this._seekTo) < 3 || performance.now() - this._seekAt > 8000) {
        this._seekTo = null; this.seeking = false;
        this._t = d.time; this._at = performance.now();
        this.fire('seeked');
      }
    } else { this._t = d.time; this._at = performance.now(); }

    const wasMoving = this._moving;
    this._moving = !!d.playing && this._seekTo == null;
    if (d.buffering && this._want && this.readyState !== 2) { this.readyState = 2; this.fire('waiting'); }
    if (!d.buffering && this.readyState < 3 && (d.playing || d.paused)) { this.readyState = 4; this.fire('canplay'); }
    if (this._moving && !wasMoving) this.fire('playing');
    // paused from outside (headphones unplugged, a call…)
    if (d.paused && this._want && !this.seeking && performance.now() - this._cmdAt > 2000) { this._want = false; this.fire('pause'); }
    this.fire('timeupdate');
    if (d.ended && !this.ended) { this.ended = true; this._want = false; this._moving = false; this.fire('pause'); this.fire('ended'); }
  }
}
