let instance = 0;
export function initCinema(el, { sfx } = {}) {
  const uid = `lp-cinema-${++instance}`;
  el.classList.add('lp-cinema');
  el.innerHTML = `<div class="lp-cinema-pediment" aria-hidden="true"><span class="lp-cinema-star">✦</span> STREAMORA PICTURE HOUSE <span class="lp-cinema-star">✦</span></div>
    <div class="lp-cinema-frame"><div class="lp-cinema-screen">
      <img class="lp-cinema-poster" src="/media/film-poster.webp" alt="A preview of the Streamora film" loading="lazy" width="1280" height="720">
      <video class="lp-cinema-video" preload="none" playsinline aria-label="The Streamora film" tabindex="-1"></video>
      <div class="lp-cinema-curtain lp-cinema-curtain-left" aria-hidden="true"><img class="lp-cinema-curtain-art" src="/media/ticket/curtain-l.webp" alt="" hidden></div>
      <div class="lp-cinema-curtain lp-cinema-curtain-right" aria-hidden="true"><img class="lp-cinema-curtain-art" src="/media/ticket/curtain-r.webp" alt="" hidden></div>
      <span class="lp-cinema-valance" aria-hidden="true"></span>
    </div></div><div class="lp-cinema-playbill"><span class="lp-cinema-note">A little window into your world.</span>
      <button class="lp-cinema-watch" type="button" aria-controls="${uid}" aria-describedby="${uid}-status">Watch the film <span aria-hidden="true">↗</span></button></div>
    <p class="lp-cinema-status" id="${uid}-status" role="status" aria-live="polite"></p>`;
  const video = el.querySelector('video'), button = el.querySelector('button'), status = el.querySelector('.lp-cinema-status');
  video.id = uid;
  const removers = [];
  const listen = (node, event, callback) => {
    node.addEventListener(event, callback, { passive: true });
    removers.push(() => node.removeEventListener(event, callback));
  };
  let dead = false, projector, observer, visible = true;
  function stopProjector() { projector?.stop(.25); projector = null; }
  function startProjector() {
    if (!projector && visible && !document.hidden) projector = sfx?.play('projector', { vol: .12 });
  }
  function pause() { video.pause(); stopProjector(); }
  function fail() {
    if (dead) return;
    pause(); el.classList.remove('lp-cinema-open');
    status.textContent = 'The film could not start. Please try again.';
    button.textContent = 'Try the film again ↗'; button.disabled = false;
  }
  el.querySelectorAll('.lp-cinema-curtain-art').forEach(img => {
    listen(img, 'load', () => { img.hidden = false; });
    listen(img, 'error', () => { img.removeAttribute('src'); });
  });
  listen(button, 'click', () => {
    if (dead) return;
    // Focus/tap can scroll the playbill into view before the observer delivers
    // its next entry. The explicit press owns this start; the observer owns exits.
    visible = true;
    sfx?.unlock(); status.textContent = '';
    // Source assignment belongs to this trusted press; never to init or intersection.
    if (!video.getAttribute('src') || video.error) {
      const small = matchMedia('(max-width: 820px)').matches || navigator.connection?.saveData;
      video.src = `/media/film-${small ? '480' : '720'}.mp4`;
    }
    video.controls = true; video.tabIndex = 0; video.muted = false;
    el.classList.add('lp-cinema-started', 'lp-cinema-open');
    sfx?.play('curtain', { vol: .45 });
    button.textContent = 'Resume the film ↗';
    try { video.play()?.catch(fail); } catch { fail(); }
  });
  listen(video, 'play', () => {
    if (!visible || document.hidden) { pause(); return; }
    el.classList.add('lp-cinema-open'); startProjector();
  });
  listen(video, 'pause', stopProjector);
  listen(video, 'ended', () => {
    stopProjector(); el.classList.remove('lp-cinema-open');
    sfx?.play('curtain', { vol: .35 }); button.textContent = 'Watch the film again ↗';
    status.textContent = 'The end. Your own world is waiting.';
  });
  listen(video, 'error', fail);
  listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (!visible) pause();
    }, { threshold: 0 });
    observer.observe(el);
  }
  return {
    destroy() {
      dead = true; observer?.disconnect(); removers.forEach(fn => fn()); pause();
      video.removeAttribute('src'); video.load();
      el.replaceChildren(); el.classList.remove('lp-cinema', 'lp-cinema-open', 'lp-cinema-started');
    },
  };
}
