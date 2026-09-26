// Deletes torrents added since tools/shots/torrents_before.json (test cleanup). Never touches the pre-existing ones.
import { readFileSync } from 'node:fs';
const K = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const before = new Set(JSON.parse(readFileSync(new URL('./shots/torrents_before.json', import.meta.url), 'utf8')));
const h = { Authorization: 'Bearer ' + K };
const now = await (await fetch('https://api.real-debrid.com/rest/1.0/torrents?limit=100', { headers: h })).json();
for (const t of now.filter(t => !before.has(t.id))) {
  const r = await fetch('https://api.real-debrid.com/rest/1.0/torrents/delete/' + t.id, { method: 'DELETE', headers: h });
  console.log('deleted', t.id, t.filename, r.status);
}
console.log('remaining', now.length - now.filter(t => !before.has(t.id)).length, 'before', before.size);
