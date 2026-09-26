// "Who's watching?" — a board of taped polaroids, the profile editor and the PIN keypad.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Modal, Field, Input, Toggle, Reel, cx, loadCSS, toast } from '../ui/components.js';
import { Avatar, AVATARS, INKS } from '../ui/avatars.js';
import { tiltOf } from '../ui/sketch.js';
import { useStore, profiles, activeProfileId, uid, ls } from '../core/store.js';
import { navigate } from '../router.js';

loadCSS('css/pages/profiles.css');

const MAX = 8;
export const THEMES = [
  { id: 'ink', name: 'Paper & Ink', paper: '#f3e6cf', ink: '#1e1630', a: '#ff4f79', b: '#ffd23f' },
  { id: 'riso', name: 'Riso Pop', paper: '#f0ece2', ink: '#22366b', a: '#ff48b0', b: '#0078bf' },
  { id: 'blueprint', name: 'Blueprint', paper: '#0b0d1f', ink: '#e8ecff', a: '#7fe7ff', b: '#ff7ab8' },
  { id: 'pencil', name: 'Pencil', paper: '#f4efe4', ink: '#201f1b', a: '#8a8a55', b: '#e8a5a5' },
  { id: 'doodle', name: 'Doodle', paper: '#efd2d1', ink: '#23202b', a: '#e8505b', b: '#5b7bd8' },
];

/** Mini paper swatch showing a theme; used here and in Settings. */
export function ThemeSwatch({ t, active, onClick }) {
  return html`<button type="button" class=${cx('pf-swatch', active && 'active')} onClick=${onClick} aria-pressed=${!!active} title=${t.name}
      style=${`--sw-paper:${t.paper};--sw-ink:${t.ink};--sw-a:${t.a};--sw-b:${t.b}`}>
    <span class="pf-swatch-sheet">
      <span class="pf-swatch-bar"></span>
      <span class="pf-swatch-card"></span><span class="pf-swatch-card b"></span>
      <span class="pf-swatch-dots"></span>
    </span>
    <span class="pf-swatch-name">${t.name}</span>
  </button>`;
}

function Keypad({ profile, onOk, onClose }) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const press = d => {
    if (code.length >= 4) return;
    const next = code + d;
    setCode(next); setBad(false);
    if (next.length === 4) {
      if (next === profile.pin) setTimeout(onOk, 150);
      else setTimeout(() => { setBad(true); setCode(''); }, 250);
    }
  };
  useEffect(() => {
    const on = e => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') setCode(c => c.slice(0, -1)); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });
  return html`<${Modal} open onClose=${onClose} title=${`${profile.name}'s PIN`}>
    <div class="pf-keypad">
      <${Avatar} id=${profile.avatar} ink=${profile.ink} size=${72} />
      <div class=${cx('pf-pin-dots', bad && 'bad')} aria-live="polite" aria-label=${`${code.length} of 4 digits`}>
        ${[0, 1, 2, 3].map(i => html`<span class=${i < code.length ? 'on' : ''}></span>`)}
      </div>
      ${bad && html`<p class="pf-bad type">nope, try again</p>`}
      <div class="pf-keys">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => html`<button type="button" class="pf-key" onClick=${() => press(d)}>${d}</button>`)}
        <span></span>
        <button type="button" class="pf-key" onClick=${() => press('0')}>0</button>
        <button type="button" class="pf-key" aria-label="Delete" onClick=${() => setCode(c => c.slice(0, -1))}><${Icon} name="back" /></button>
      </div>
    </div>
  <//>`;
}

function Editor({ initial, onSave, onDelete, onClose }) {
  const [p, set] = useState(initial);
  const [pinOn, setPinOn] = useState(!!initial.pin);
  const [confirmDel, setConfirmDel] = useState(false);
  const up = patch => set(x => ({ ...x, ...patch }));
  const valid = p.name.trim() && (!pinOn || /^\d{4}$/.test(p.pin || ''));
  const save = e => {
    e.preventDefault();
    if (!valid) return;
    onSave({ ...p, name: p.name.trim().slice(0, 20), pin: pinOn ? p.pin : null });
  };
  return html`<${Modal} open wide onClose=${onClose} title=${initial.created ? 'Edit profile' : 'New profile'}>
    <form class="pf-editor" onSubmit=${save}>
      <div class="pf-editor-preview">
        <div class="pf-polaroid static" style="--tilt:-3deg"><span class="tape top"></span><${Avatar} id=${p.avatar} ink=${p.ink} size=${130} /><span class="pf-name">${p.name || 'Someone'}</span>${p.kids && html`<span class="pf-kids-badge type">kids</span>`}</div>
      </div>
      <div class="pf-editor-form">
        <${Field} label="Name"><${Input} value=${p.name} maxlength="20" placeholder="Who's this?" onInput=${e => up({ name: e.currentTarget.value })} /><//>
        <div class="field"><span class="field-label">Character</span>
          <div class="pf-avatar-grid" role="radiogroup" aria-label="Avatar">
            ${AVATARS.map(a => html`<button type="button" role="radio" aria-checked=${p.avatar === a.id} class=${cx('pf-avatar-pick', p.avatar === a.id && 'active')} onClick=${() => up({ avatar: a.id })} title=${a.name}>
              <${Avatar} id=${a.id} ink=${p.ink} size=${54} />
            </button>`)}
          </div>
        </div>
        <div class="field"><span class="field-label">Ink colour</span>
          <div class="pf-inks" role="radiogroup" aria-label="Ink colour">
            ${INKS.map(c => html`<button type="button" role="radio" aria-checked=${p.ink === c} aria-label=${c} class=${cx('pf-ink', p.ink === c && 'active')} style=${`--c:${c}`} onClick=${() => up({ ink: c })}></button>`)}
          </div>
        </div>
        <div class="field"><span class="field-label">Theme</span>
          <div class="pf-themes">${THEMES.map(t => html`<${ThemeSwatch} t=${t} active=${p.theme === t.id} onClick=${() => up({ theme: t.id })} />`)}</div>
        </div>
        <${Toggle} checked=${!!p.kids} onChange=${v => up({ kids: v, theme: v && p.theme === 'ink' ? 'pencil' : p.theme })} label="Kids profile (family-friendly titles only)" />
        <${Toggle} checked=${pinOn} onChange=${setPinOn} label="Lock with a 4-digit PIN" />
        ${pinOn && html`<${Field} label="PIN" hint="4 digits"><${Input} value=${p.pin || ''} inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" onInput=${e => up({ pin: e.currentTarget.value.replace(/\D/g, '').slice(0, 4) })} /><//>`}
        <div class="spread pf-editor-actions">
          ${onDelete ? (confirmDel
            ? html`<span class="cluster"><span class="type">Delete ${initial.name} and all their history?</span><${Btn} variant="danger" size="sm" icon="trash" onClick=${onDelete}>Yes, delete<//><${Btn} size="sm" variant="ghost" onClick=${() => setConfirmDel(false)}>Keep<//></span>`
            : html`<${Btn} variant="ghost" icon="trash" onClick=${() => setConfirmDel(true)}>Delete<//>`) : html`<span></span>`}
          <${Btn} variant="primary" icon="check" type="submit" disabled=${!valid}>Save<//>
        </div>
      </div>
    </form>
  <//>`;
}

export default function Profiles() {
  const list = useStore(profiles);
  const activeId = useStore(activeProfileId);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState(null);
  const [locked, setLocked] = useState(null);
  const [leaving, setLeaving] = useState(null);

  useEffect(() => {
    if (!list.length && !editing) setEditing(blank(0));
  }, [list.length]);

  function blank(n) {
    return { id: uid(), name: '', avatar: AVATARS[(n * 7) % AVATARS.length].id, ink: INKS[n % INKS.length], theme: 'ink', kids: false, pin: null };
  }

  const enter = p => {
    setLeaving(p.id);
    setTimeout(() => { activeProfileId.set(p.id); navigate('/'); }, 420);
  };
  const pick = p => {
    if (manage) return setEditing(p);
    if (p.pin && p.id !== activeId) return setLocked(p);
    enter(p);
  };
  const save = p => {
    const exists = list.some(x => x.id === p.id);
    profiles.set(exists ? list.map(x => (x.id === p.id ? p : x)) : [...list, { ...p, created: Date.now() }]);
    setEditing(null);
    toast(exists ? 'Profile updated' : `Say hi to ${p.name}!`, { icon: 'sparkle' });
    if (!exists && list.length === 0) enter(p);
  };
  const del = p => {
    profiles.set(list.filter(x => x.id !== p.id));
    for (const k of ls.keys()) if (k.startsWith(`p:${p.id}:`)) ls.del(k);
    if (activeId === p.id) activeProfileId.set(null);
    setEditing(null);
    toast(`${p.name} was erased`, { icon: 'trash' });
  };

  return html`<main class=${cx('pf-page', leaving && 'leaving')}>
    <div class="pf-head">
      <${Reel} mood=${manage ? 'think' : 'wave'} size=${92} />
      <h1 class="pf-title">${manage ? 'Manage profiles' : 'Who\'s watching?'}</h1>
    </div>
    <div class="pf-board">
      ${list.map((p, i) => html`<button type="button" key=${p.id}
          class=${cx('pf-polaroid', manage && 'wiggle', leaving === p.id && 'chosen', p.id === activeId && 'current')}
          style=${`--tilt:${tiltOf(p.id, 4).toFixed(2)}deg;animation-delay:${i * 60}ms`} onClick=${() => pick(p)} aria-label=${manage ? `Edit ${p.name}` : `Watch as ${p.name}`}>
        <span class=${cx('tape', i % 3 === 0 ? 'tl' : i % 3 === 1 ? 'top' : 'tr', i % 2 && 'alt')}></span>
        <${Avatar} id=${p.avatar} ink=${p.ink} size=${128} />
        <span class="pf-name">${p.name}</span>
        ${p.pin && html`<span class="pf-lock" title="PIN locked"><${Icon} name="lock" size=${18} /></span>`}
        ${p.kids && html`<span class="pf-kids-badge type">kids</span>`}
        ${manage && html`<span class="pf-edit-badge"><${Icon} name="pencil" size=${22} /></span>`}
      </button>`)}
      ${list.length < MAX && html`<button type="button" class="pf-polaroid pf-add" style="--tilt:2deg" onClick=${() => setEditing(blank(list.length))} aria-label="Add profile">
        <span class="pf-add-plus"><${Icon} name="plus" size=${54} /></span>
        <span class="pf-name">Add profile</span>
      </button>`}
    </div>
    ${list.length > 0 && html`<div class="pf-foot cluster">
      <${Btn} variant=${manage ? 'primary' : 'ink'} icon=${manage ? 'check' : 'pencil'} onClick=${() => setManage(!manage)}>${manage ? 'Done' : 'Manage profiles'}<//>
      ${activeId && !manage && html`<${Btn} variant="ghost" icon="back" href="#/">Back to watching<//>`}
    </div>`}
    ${editing && html`<${Editor} initial=${editing} onClose=${list.length ? () => setEditing(null) : null} onSave=${save} onDelete=${list.some(x => x.id === editing.id) ? () => del(editing) : null} />`}
    ${locked && html`<${Keypad} profile=${locked} onClose=${() => setLocked(null)} onOk=${() => { const p = locked; setLocked(null); enter(p); }} />`}
  </main>`;
}
