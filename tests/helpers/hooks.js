import { html } from '../../vendor/preact-htm.js';
import { flush } from './source.js';

// A small hook host for testing component transitions without DOM or network services.
export function hooks() {
  const slots = [], pending = new Set();
  let cursor = 0, dirty = true, comp, props, tree, updates = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const scope = {
    html,
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; updates++; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return scope.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) { slots[i] = { ...slots[i], fn, deps }; pending.add(i); }
    },
    useErrorBoundary() { return scope.useState(null); },
  };
  const render = () => { cursor = 0; dirty = false; tree = comp(props); return tree; };
  return {
    scope,
    mount(fn, values) { comp = fn; props = values; return render(); },
    render,
    get updates() { return updates; },
    commit(match = () => true) {
      for (const i of [...pending]) if (match(slots[i].fn)) {
        pending.delete(i); slots[i].cleanup?.(); slots[i].cleanup = slots[i].fn();
      }
    },
    async settle() {
      for (let n = 0; n < 20; n++) {
        if (dirty) render();
        for (const i of [...pending]) { pending.delete(i); slots[i].cleanup?.(); slots[i].cleanup = slots[i].fn(); }
        await flush();
        if (!dirty && !pending.size) return tree;
      }
      throw Error('component did not settle');
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
export function nodes(tree, predicate) {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
