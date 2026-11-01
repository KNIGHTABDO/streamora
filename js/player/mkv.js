// Lazy, client-only Matroska -> fragmented MP4. Video packets stay encoded.
import { canRemuxMkv, planAudio } from './mkv-plan.js';

let ac3Ready;
const failure = (code, message) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Like attach(), with an optional signal so leaving during metadata loading also cancels the fetches. */
export async function attachMkv(video, url, { start = 0, audioLang, onFatal = () => {}, signal } = {}) {
  if (!canRemuxMkv()) throw failure('mkvvideo', 'This browser cannot play MKV. Pick another source.');
  const MS = window.MediaSource || window.ManagedMediaSource;
  let input, ms, sb, objectUrl, conversion, execution, timer, abortRun, serial = Promise.resolve();
  let dead = false, generation = 0, conversionGeneration = -1, reported = false, duration = 0, pendingPosition = null;
  const lifetime = new AbortController();
  const active = g => !dead && g === generation;
  const supported = mime => !!MS.isTypeSupported(mime);
  const buffered = t => {
    for (let i = 0; sb && i < sb.buffered.length; i++) if (t >= sb.buffered.start(i) && t < sb.buffered.end(i)) return true;
    return false;
  };
  const ahead = () => {
    for (let i = 0; sb && i < sb.buffered.length; i++) {
      if (video.currentTime >= sb.buffered.start(i) - .5 && video.currentTime <= sb.buffered.end(i)) return sb.buffered.end(i) - video.currentTime;
    }
    return 0;
  };
  const fatal = (e, g) => {
    if (!active(g) || reported) return;
    reported = true;
    // Network/library errors can contain signed URLs. Keep those out of app diagnostics.
    onFatal(failure(e.code || 'mkvvideo', e.code === 'mkvaudio' ? 'This copy’s audio cannot play here. Pick another source.' : 'This MKV could not be played. Pick another source.'), video.currentTime || start);
  };
  const position = () => {
    if (pendingPosition == null) return;
    // Before metadata, currentTime queues a seek without emitting 'seeking'.
    // Honor that request before our initial position write can overwrite it.
    if (video.currentTime > 0 && Math.abs(video.currentTime - pendingPosition) > .15 && !buffered(video.currentTime)) {
      seeking(); return;
    }
    if (!buffered(pendingPosition)) return;
    const t = pendingPosition;
    pendingPosition = null;
    if (Math.abs(video.currentTime - t) > .1) video.currentTime = t;
  };
  const detach = () => {
    if (dead) return;
    dead = true; generation++; clearTimeout(timer);
    lifetime.abort(); abortRun?.abort();
    signal?.removeEventListener('abort', detach);
    video.removeEventListener('seeking', seeking);
    video.removeEventListener('canplay', position);
    // Disposing aborts UrlSource's in-flight range requests, including metadata reads.
    input?.dispose();
    conversion?.cancel().catch(() => {});
    video.removeAttribute('src'); video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
  // Waits always release on detach, even when MSE never fires another event.
  const event = (target, name, action) => new Promise((resolve, reject) => {
    const clean = () => {
      target.removeEventListener(name, ok); target.removeEventListener('error', bad);
      target.removeEventListener('abort', bad); lifetime.signal.removeEventListener('abort', stop);
    };
    const ok = () => { clean(); resolve(); };
    const bad = () => { clean(); reject(failure('mkvvideo', 'Could not buffer this MKV.')); };
    const stop = () => { clean(); resolve(); };
    if (dead) return resolve();
    target.addEventListener(name, ok, { once: true }); target.addEventListener('error', bad, { once: true });
    target.addEventListener('abort', bad, { once: true }); lifetime.signal.addEventListener('abort', stop, { once: true });
    try { action?.(); } catch (e) { clean(); reject(e); }
  });
  const idle = async () => { if (sb?.updating) await event(sb, 'updateend'); };
  const remove = async end => {
    if (dead || !sb || end <= 0 || !sb.buffered.length || sb.buffered.start(0) >= end) return;
    await idle();
    if (!dead) await event(sb, 'updateend', () => sb.remove(0, end));
  };
  const cancel = async () => {
    const old = conversion;
    conversion = null;
    if (old) try { await old.cancel(); } catch {}
    if (execution) await execution; // execute's rejection is handled below
    execution = null;
    await idle();
  };
  // Bump immediately, before the debounce, so an old writer cannot append during rapid scrubbing.
  function seeking() {
    const t = video.currentTime;
    if (pendingPosition != null && Math.abs(t - pendingPosition) < .15) return;
    if (buffered(t) && conversionGeneration === generation) { pendingPosition = null; return; }
    const end = sb?.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0;
    if (conversionGeneration === generation && conversion?.state === 'executing' && t >= end && t - end <= 15) return;
    pendingPosition = t;
    const g = ++generation;
    abortRun?.abort();
    clearTimeout(timer);
    timer = setTimeout(() => {
      serial = serial.then(async () => {
        await cancel();
        if (!active(g)) return;
        // abort resets the old MP4 parser, including any incomplete fragment.
        if (sb && ms.readyState === 'ended') sb.timestampOffset = sb.timestampOffset; // reopens MSE after EOF
        sb?.abort();
        await remove(duration || Infinity);
        if (active(g)) await begin(t, g);
      }).catch(e => fatal(e, g));
    }, 150);
  }
  let begin;
  signal?.addEventListener('abort', detach, { once: true });
  if (signal?.aborted) { detach(); return detach; }
  try {
    const { Input, UrlSource, MATROSKA, EncodedPacketSink, Output, Mp4OutputFormat, StreamTarget, Conversion, canEncodeAudio } = await import('mediabunny');
    if (dead) return detach;
    input = new Input({ source: new UrlSource(url, { getRetryDelay: n => n <= 3 ? n : null, handleUnhandledError: e => fatal(e, generation) }), formats: [MATROSKA] });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (dead) return detach;
    const videoCodec = videoTrack && await videoTrack.getCodecParameterString();
    if (!videoCodec || !supported(`video/mp4; codecs="${videoCodec}"`)) throw failure('mkvvideo', 'This copy’s video cannot play here. Pick another source.');
    const audioTracks = await input.getAudioTracks();
    if (audioTracks.some(t => /^(ac3|eac3)$/.test(t.codec)) && !supported('audio/mp4; codecs="ec-3"')) {
      ac3Ready ||= import('../../vendor/mediabunny-ac3.min.mjs').then(m => m.registerAc3Decoder()).catch(e => { ac3Ready = null; throw e; });
      await ac3Ready;
    }
    if (dead) return detach;
    const tracks = await Promise.all(audioTracks.map(async t => ({
      id: t.id, codec: t.codec, languageCode: t.languageCode,
      canDecode: await t.canDecode().catch(() => false),
      mseOk: supported(`audio/mp4; codecs="${await t.getCodecParameterString()}"`),
    })));
    let encodeTarget = null;
    for (const [codec, param] of [['opus', 'opus'], ['aac', 'mp4a.40.2']]) {
      if (supported(`audio/mp4; codecs="${param}"`) && await canEncodeAudio(codec, { numberOfChannels: 2, bitrate: 192000 })) { encodeTarget = codec; break; }
    }
    const audio = planAudio(tracks, audioLang, encodeTarget);
    if (!audio) throw failure('mkvaudio', 'This copy’s audio cannot play here. Pick another source.');
    duration = await input.getDurationFromMetadata() ?? await input.computeDuration();
    if (dead) return detach;
    ms = new MS();
    if (!window.MediaSource) video.disableRemotePlayback = true;
    objectUrl = URL.createObjectURL(ms);
    const opened = event(ms, 'sourceopen');
    video.src = objectUrl;
    await opened;
    if (dead) return detach;
    ms.duration = duration;
    video.addEventListener('seeking', seeking);
    video.addEventListener('canplay', position);
    begin = async (t, g) => {
      const packet = await new EncodedPacketSink(videoTrack).getKeyPacket(t);
      if (!active(g)) return;
      const keyTs = Math.max(0, packet?.timestamp || 0);
      let written = 0, header;
      const run = abortRun = new AbortController();
      let release;
      const ready = new Promise(resolve => { release = resolve; });
      run.signal.addEventListener('abort', () => release(false), { once: true });
      const writable = new WritableStream({
        async write({ data, position: offset }) {
          if (!active(g)) return;
          if (offset !== written) throw failure('mkvvideo', 'The MKV output was not sequential.');
          written += data.byteLength;
          // MP4 writes ftyp before it knows the codec strings. Hold just that header;
          // awaiting getMimeType before execute (or in this first write) deadlocks.
          if (offset === 0) { header = data; return; }
          if (!await ready || !active(g)) return;
          while (active(g) && ahead() > 60) await sleep(100);
          if (!active(g)) return;
          await idle();
          if (!active(g)) return;
          try { await event(sb, 'updateend', () => sb.appendBuffer(data)); }
          catch (e) {
            if (!active(g)) return;
            if (e.name !== 'QuotaExceededError') throw e;
            await remove(video.currentTime - 10);
            while (active(g) && ahead() >= 20) await sleep(100);
            if (!active(g)) return;
            await event(sb, 'updateend', () => sb.appendBuffer(data));
          }
          if (!active(g)) return;
          position();
          await remove(video.currentTime - 60);
        },
      });
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 2 }), target: new StreamTarget(writable) });
      const next = await Conversion.init({
        input, output, trim: { start: keyTs }, showWarnings: false,
        video: track => track.id === videoTrack.id ? { codec: track.codec } : { discard: true },
        audio: track => track.id !== audio.id ? { discard: true } : audio.mode === 'transcode'
          ? { codec: audio.codec, numberOfChannels: 2, bitrate: 192000 } : { codec: track.codec },
      });
      if (!active(g)) { await next.cancel(); return; }
      if (!next.isValid || !next.utilizedTracks.includes(videoTrack)) throw failure('mkvvideo', 'This copy’s video cannot play here.');
      if (audio.mode !== 'none' && !next.utilizedTracks.some(track => track.id === audio.id)) throw failure('mkvaudio', 'This copy’s audio cannot play here.');
      pendingPosition = t;
      conversion = next; conversionGeneration = g;
      execution = next.execute().then(() => {
        if (active(g) && ms.readyState === 'open' && sb && !sb.updating) ms.endOfStream();
      }).catch(e => fatal(e, g));
      let stop;
      const cancelled = new Promise(resolve => {
        stop = () => resolve(null);
        run.signal.addEventListener('abort', stop, { once: true });
      });
      const mime = await Promise.race([output.getMimeType(), cancelled, execution.then(() => null)]);
      run.signal.removeEventListener('abort', stop);
      if (!active(g) || !mime) { release(false); await next.cancel(); return; }
      try {
        if (!supported(mime)) throw failure('mkvvideo', 'This copy cannot play here.');
        if (!sb) { sb = ms.addSourceBuffer(mime); sb.mode = 'segments'; }
        // Mediabunny 1.65 subtracts trim.start from both tracks (src/conversion.ts).
        sb.timestampOffset = keyTs;
        if (header) await event(sb, 'updateend', () => sb.appendBuffer(header));
        release(true);
      } catch (e) { release(false); await next.cancel(); throw e; }
    };
    serial = begin(Math.max(0, start), generation);
    await serial;
    return detach;
  } catch (e) {
    const cancelled = dead;
    detach();
    if (cancelled) return detach;
    throw failure(e.code === 'mkvaudio' ? 'mkvaudio' : 'mkvvideo', e.code === 'mkvaudio' ? 'This copy’s audio cannot play here. Pick another source.' : 'This copy’s video cannot play here. Pick another source.');
  }
}
