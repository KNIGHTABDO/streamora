import test from 'node:test';
import assert from 'node:assert/strict';
import { source, evaluate, deferred, flush } from './helpers/source.js';
import { planAudio } from '../js/player/mkv-plan.js';

for (const defaultPosition of [false, true]) test(defaultPosition ? 'a pre-metadata seek is not overwritten by the initial playback position' : 'a seek that supersedes the initial keyframe lookup can create the first SourceBuffer', async () => {
  const keyframe = deferred(), restarted = deferred();
  const video = new EventTarget();
  Object.assign(video, { currentTime: 0, removeAttribute() {}, load() {} });
  let lookup = 0, buffers = 0;
  class MS extends EventTarget {
    static isTypeSupported() { return true; }
    readyState = 'open';
    addSourceBuffer() {
      buffers++;
      const buffer = new EventTarget();
      Object.assign(buffer, { buffered: { length: 1, start: () => 0, end: () => 2 }, updating: false,
        abort() {}, remove() { buffer.buffered.length = 0; queueMicrotask(() => buffer.dispatchEvent(new Event('updateend'))); },
      });
      return buffer;
    }
    endOfStream() { this.readyState = 'ended'; }
  }
  const ms = new MS();
  Object.defineProperty(video, 'src', { set() { queueMicrotask(() => ms.dispatchEvent(new Event('sourceopen'))); } });
  const track = { id: 1, codec: 'avc', getCodecParameterString: async () => 'avc1.640028' };
  const fatal = [];
  const attach = evaluate(source('js/player/mkv.js').replace("await import('mediabunny')", 'bunny'), {
    window: { MediaSource: class { static isTypeSupported = MS.isTypeSupported; constructor() { return ms; } } },
    canRemuxMkv: () => true, planAudio, AbortController, WritableStream,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout, clearTimeout,
    bunny: {
      Input: class { async getPrimaryVideoTrack() { return track; } async getAudioTracks() { return []; } async getDurationFromMetadata() { return 1000; } dispose() {} },
      UrlSource: class {}, MATROSKA: {}, canEncodeAudio: async () => true,
      EncodedPacketSink: class { getKeyPacket(t) { lookup++; return lookup === 1 ? keyframe.promise : Promise.resolve({ timestamp: t }); } },
      Output: class { async getMimeType() { return 'video/mp4; codecs="avc1.640028"'; } },
      Mp4OutputFormat: class {}, StreamTarget: class {},
      Conversion: { init: async () => ({ isValid: true, utilizedTracks: [track], execute: () => restarted.promise, cancel: async () => restarted.resolve() }) },
    },
  }, 'attachMkv');
  const pending = attach(video, 'mock-file', { onFatal: e => fatal.push(e.code) });
  await flush();
  assert.equal(lookup, 1);
  video.currentTime = 300;
  if (!defaultPosition) video.dispatchEvent(new Event('seeking'));
  keyframe.resolve({ timestamp: 0 });
  const detach = await pending;
  if (defaultPosition) video.dispatchEvent(new Event('canplay'));
  try {
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.deepEqual(fatal, []);
    assert.equal(buffers, 1);
    assert.equal(lookup, 2);
    assert.equal(video.currentTime, 300);
  } finally { detach(); await flush(); }
});
