// One owner for asynchronous subtitle selections, including Off and leaving the Player.
export function createSubtitleLoader({ load, onLoading, onCues, onOff, onError }) {
  let version = 0, disposed = false;
  const isCurrent = value => !disposed && value === version;
  return {
    get version() { return version; },
    isCurrent,
    async choose(it) {
      if (disposed) return;
      const current = ++version;
      if (!it) { onOff(); return; }
      onLoading(it);
      try {
        const cues = await load(it);
        if (isCurrent(current)) onCues(it, cues);
      } catch (e) {
        if (isCurrent(current)) onError(e);
      }
    },
    dispose() { disposed = true; version++; },
  };
}
