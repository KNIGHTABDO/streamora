// Page-side startup policy. A media fragment (not the MP4 init header) commits
// the session to the worker; only failures before that may retry on the page.
// Terminal states ignore late messages from a terminated worker.
export function workerState(state, message) {
  if (['stopped', 'fallback', 'failed'].includes(state)) return state;
  if (message?.type === 'stop') return 'stopped';
  if (message?.type === 'error') return state === 'running' ? 'failed' : 'fallback';
  if (message?.type === 'handle' && state === 'starting') return 'attached';
  if (message?.type === 'ready' && state === 'attached') return 'running';
  return state;
}

// The vendored AC3 module itself has bare Mediabunny imports. Resolve those
// imports for the worker without changing the vendor file used by the page.
export function ac3WorkerSource(source, mediabunnyUrl) {
  return source.replace(/\bfrom\s*(['"])mediabunny\1/g, () => `from ${JSON.stringify(mediabunnyUrl)}`);
}

async function loadAc3(signal) {
  const response = await fetch(new URL('../../vendor/mediabunny-ac3.min.mjs', import.meta.url), { signal });
  if (!response.ok) throw new Error('Could not load the audio decoder.');
  const source = ac3WorkerSource(await response.text(), new URL('../../vendor/mediabunny.min.mjs', import.meta.url).href);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { return await import(url); }
  finally { URL.revokeObjectURL(url); }
}

// Safe to import on the page and in node tests: only a dedicated worker installs
// the runtime. Import maps do not apply here, so both vendor imports are URLs.
if (typeof DedicatedWorkerGlobalScope !== 'undefined' && globalThis instanceof DedicatedWorkerGlobalScope) {
  let controller, detach, stopped = false, started = false, appended = false, time = 0, epoch = 0;
  const video = new EventTarget();
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: value => { time = value; postMessage({ type: 'position', time, epoch }); },
  });
  video.removeAttribute = video.load = () => {};
  const stop = () => {
    stopped = true;
    controller?.abort(); detach?.();
  };
  const fail = error => {
    if (stopped) return;
    // Never send a library error's message/stack: it may contain a signed URL.
    postMessage({ type: 'error', code: error?.code === 'mkvaudio' ? 'mkvaudio' : 'mkvvideo' });
    stop();
  };
  addEventListener('unhandledrejection', event => { event.preventDefault(); fail(event.reason); });
  addEventListener('message', async ({ data }) => {
    if (data.type === 'stop') { stop(); close(); return; }
    if (stopped) return;
    if (data.type === 'playback') {
      if (!Number.isFinite(data.time) || data.time < 0 || !Number.isInteger(data.epoch) || data.epoch < epoch) return;
      time = data.time; epoch = data.epoch;
      if (data.event === 'seeking' || data.event === 'canplay') video.dispatchEvent(new Event(data.event));
      return;
    }
    if (data.type !== 'start' || started) return;
    started = true;
    time = Number.isFinite(data.time) ? data.time : 0;
    controller = new AbortController();
    postMessage({ type: 'started' });
    try {
      const { attachMkvMain } = await import('./mkv.js');
      if (stopped) return;
      detach = await attachMkvMain(video, data.url, {
        start: data.start, audioLang: data.audioLang, signal: controller.signal, onFatal: fail,
      }, {
        MS: MediaSource,
        load: () => import('../../vendor/mediabunny.min.mjs'),
        loadAc3: () => loadAc3(controller.signal),
        attachSource: ms => postMessage({ type: 'handle', handle: ms.handle }, [ms.handle]),
        opened: () => postMessage({ type: 'opened' }),
        appended: () => {
          if (!appended && !stopped) { appended = true; postMessage({ type: 'ready' }); }
        },
      });
      if (stopped) detach();
    } catch (error) { fail(error); }
  });
}
