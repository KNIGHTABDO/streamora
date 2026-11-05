// TV remote / keyboard spatial navigation: arrow keys move focus to the nearest focusable in that direction.
// Only kicks in once the user presses an arrow key outside a text field, so mouse/touch users never notice.
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function visible(el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"], [inert]');
}

function scope() {
  // stay inside an open modal/drawer/player overlay when there is one
  return document.querySelector('.modal-scrim .modal, .drawer-scrim.open .drawer, [data-focus-scope]') || document.body;
}

// Arrow keys on a shelf page only look at the shelf the focus is on and the one above or below it (plus anything
// between them), so a press doesn't measure every card on the page. Nothing found there: look at everything.
const FOLLOWS = 4, PRECEDES = 2;
function nearby(all, cur, dx, dy) {
  const row = cur.closest && cur.closest('section.row');
  if (!row) return null;
  const rows = [...(cur.closest('.page-enter') || scope()).querySelectorAll('section.row')];
  const i = rows.indexOf(row);
  const from = dy < 0 ? rows[i - 1] || null : row;
  const to = dy > 0 ? rows[i + 1] || null : row;
  return all.filter(el => (!from || from === el || from.compareDocumentPosition(el) & FOLLOWS)
    && (!to || to.contains(el) || to.compareDocumentPosition(el) & PRECEDES));
}

function pick(cands, a, dx, dy) {
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity, bestRect = null;
  for (const el of cands) {
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = (bx - ax) * dx + (by - ay) * dy;
    if (along <= 4) continue;
    const across = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
    // overlap on the cross axis is strongly preferred (same row / same column)
    const overlap = dx ? (b.bottom > a.top && b.top < a.bottom) : (b.right > a.left && b.left < a.right);
    const score = along + across * (overlap ? .5 : 3);
    if (score < bestScore) { bestScore = score; best = el; bestRect = b; }
  }
  return best && { el: best, rect: bestRect };
}

export function moveFocus(key) {
  const [dx, dy] = DIRS[key];
  const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const all = [...scope().querySelectorAll(FOCUSABLE)];
  const usable = list => list.filter(el => el !== cur && visible(el));
  if (!cur) { const first = usable(all)[0]; first && first.focus(); return true; }
  const a = cur.getBoundingClientRect();
  const near = nearby(all, cur, dx, dy);
  const found = (near && pick(usable(near), a, dx, dy)) || pick(usable(all), a, dx, dy);
  if (!found) return false;
  const best = found.el;
  best.focus({ preventScroll: true });
  // a long jump scrolls straight there: a smooth scroll across screens keeps the page busy for half a second
  const behavior = Math.abs(found.rect.top - a.top) > innerHeight ? 'instant' : 'smooth';
  best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
  // keep rows readable: centre vertically when moving between rows
  if (dy) best.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
  return true;
}

export function initFocus() {
  addEventListener('keydown', e => {
    if (!DIRS[e.key] || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !(t.type === 'checkbox' || t.type === 'range' && DIRS[e.key][1])) return;
    if (t && t.closest && t.closest('[data-own-arrows]')) return; // e.g. the video player, sliders
    if (moveFocus(e.key)) e.preventDefault();
  });
  // TV remotes often send Backspace / "GoBack" for back
  addEventListener('keydown', e => {
    if ((e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)))) {
      if (document.querySelector('.modal-scrim, .drawer-scrim.open')) return;
      history.back();
    }
  });
}
