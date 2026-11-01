// Native details remains the source of truth. Layout is committed once per
// toggle; subsequent paper leaves travel to their new positions by transform.
export function initFlaps(el, { sfx } = {}) {
  const flaps = [...el.querySelectorAll('details.lp-flap')];
  const cleanups = [], animations = new Set(), leaves = new Map();
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const originalOpen = new Map(flaps.map(flap => [flap, flap.open]));
  let dead = false;
  el.classList.add('lp-flaps');
  const animate = (node, frames, options) => {
    const animation = node.animate(frames, options); animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  };
  function followingPaper() {
    const nodes = new Set(flaps);
    // Include later sections, so the one layout commit doesn't visibly jump the page.
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
        if (!['SCRIPT', 'STYLE', 'LINK'].includes(next.tagName)) nodes.add(next);
      }
      if (node.id === 'landing') break;
    }
    return [...nodes];
  }
  function change(flap) {
    if (dead) return;
    animations.forEach(a => a.cancel()); animations.clear();
    const nodes = reduced() ? [] : followingPaper();
    const before = nodes.map(node => node.getBoundingClientRect().top);
    const opening = !flap.open;
    flaps.forEach(other => { if (other !== flap) other.open = false; });
    flap.open = opening;
    sfx?.unlock(); sfx?.play('flap', { vol: .4, rate: opening ? 1 : .85 });
    if (reduced()) return;
    // Two batches of reads at interaction time, never in an animation frame loop.
    const after = nodes.map(node => node.getBoundingClientRect().top);
    nodes.forEach((node, i) => {
      const delta = before[i] - after[i];
      if (Math.abs(delta) > .5) animate(node, [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.25,1)' });
    });
    const leaf = leaves.get(flap), shade = leaf.querySelector('.lp-flap-shade');
    animate(leaf, opening ? [
      { transform: 'perspective(700px) rotateX(0deg)', opacity: 1 },
      { transform: 'perspective(700px) rotateX(-76deg)', opacity: .85, offset: .7 },
      { transform: 'perspective(700px) rotateX(-91deg)', opacity: 0 },
    ] : [
      { transform: 'perspective(700px) rotateX(-88deg)', opacity: 0 },
      { transform: 'perspective(700px) rotateX(4deg)', opacity: 1, offset: .8 },
      { transform: 'perspective(700px) rotateX(0deg)', opacity: 0 },
    ], { duration: 320, easing: 'cubic-bezier(.2,.65,.25,1)' });
    animate(shade, [{ opacity: 0 }, { opacity: .7, offset: .5 }, { opacity: 0 }], { duration: 320 });
    if (opening) animate(flap.querySelector('.lp-flap-a'), [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220 });
  }
  let hasOpen = false;
  flaps.forEach(flap => {
    if (flap.open) { if (hasOpen) flap.open = false; hasOpen = true; }
    const summary = flap.querySelector('summary');
    if (!summary) return;
    const leaf = document.createElement('span');
    leaf.className = 'lp-flap-leaf'; leaf.setAttribute('aria-hidden', 'true'); leaf.inert = true;
    const copy = document.createElement('span'); copy.className = 'lp-flap-leaf-copy'; copy.textContent = summary.textContent;
    const shade = document.createElement('span'); shade.className = 'lp-flap-shade';
    leaf.append(copy, shade); summary.append(leaf); leaves.set(flap, leaf);
    const click = e => { e.preventDefault(); change(flap); };
    // Keyboard activation of a summary produces a click, preserving native keys.
    summary.addEventListener('click', click, { passive: false });
    cleanups.push(() => summary.removeEventListener('click', click));
    // Also keep programmatic/native toggles exclusive.
    const toggle = () => {
      if (flap.open) flaps.forEach(other => { if (other !== flap && other.open) other.open = false; });
    };
    flap.addEventListener('toggle', toggle, { passive: true });
    cleanups.push(() => flap.removeEventListener('toggle', toggle));
  });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const motionChange = () => { if (motionQuery.matches) { animations.forEach(a => a.cancel()); animations.clear(); } };
  motionQuery.addEventListener('change', motionChange, { passive: true });
  cleanups.push(() => motionQuery.removeEventListener('change', motionChange));
  return {
    destroy() {
      dead = true; cleanups.forEach(fn => fn()); animations.forEach(a => a.cancel());
      leaves.forEach(leaf => leaf.remove()); originalOpen.forEach((open, flap) => { flap.open = open; });
      el.classList.remove('lp-flaps');
    },
  };
}
