// fetch with a deadline. A caller-provided opts.signal still aborts it. A timeout throws an Error (code 'timeout')
// saying who didn't answer, e.g. fetchT(url, {}, 12000, 'Torrentio').
export async function fetchT(url, opts = {}, ms = 12000, who = 'The server') {
  const ac = new AbortController(), sig = opts.signal;
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ac.abort(); }, ms);
  const onAbort = () => ac.abort();
  if (sig) { if (sig.aborted) ac.abort(); else sig.addEventListener('abort', onAbort, { once: true }); }
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  catch (e) {
    if (timedOut) throw Object.assign(new Error(`${who} didn't answer in time`), { code: 'timeout' });
    throw e;
  } finally { clearTimeout(t); if (sig) sig.removeEventListener('abort', onAbort); }
}
