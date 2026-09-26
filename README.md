# Streamora ✎

A sketchbook that plays movies. Streamora is a bring-your-own-key streaming app powered by **Real-Debrid**. It has hand-drawn everything, multiple profiles, and no accounts; all of your data stays on your device.

## Run it locally
```bash
node dev-server.mjs          # http://localhost:5173 (your phone on the same Wi-Fi works too, the URL is printed)
```
No install and no build step. It needs Node 18+.

## Put it online (free, works on your iPhone anywhere)
See **[DEPLOY.md](DEPLOY.md)**. It takes about 2 minutes with Cloudflare Pages.

## How it works
| Piece | What it does |
|---|---|
| Cinemeta + Kitsu | catalog, posters, episodes (free, no key needed) |
| Torrentio | finds sources and marks the ones Real-Debrid already has cached `[RD+]` |
| Real-Debrid | resolves a source → converts it to HLS → streams straight to your device |
| `functions/api/rd` | ~20-line relay, because Real-Debrid's API blocks browsers (no CORS). It stores nothing |

The video never goes through the relay: it streams from Real-Debrid's servers directly. HLS plays natively on iPhone/Safari and through hls.js everywhere else, which is why mkv/HEVC/EAC3 files still play on an iPhone.

## Privacy
- Your RD key is AES-GCM encrypted in the browser, with a non-extractable key held in IndexedDB.
- Profiles, watchlists, progress and diary live in `localStorage` on this device. You can move them to another device with **Settings → Backup** (a file or a QR code).
- The key *is* sent to Torrentio, which it needs to report `[RD+]` cached status. This is the same thing Stremio does.
- You're responsible for what you stream.

## Project map
```
index.html · manifest.webmanifest · sw.js
css/      paper.css (5 themes) · components.css · app.css · pages/*.css · player.css
js/core/  store, rd, meta, sources, progress, parse
js/ui/    sketch (hand-drawn geometry) · icons · reel (mascot) · avatars · components · focus (TV remote)
js/pages/ one file per section (home, detail, watch, movies, shows, anime, myrd, search, mood, genres, collections, calendar, diary, …)
          mood = wheel + "just pick for me" scratch card · genres = stickers + decades · collections = franchises + around the world
          diary/wrapped.js = Year in Review, opened from the Diary (old #/surprise #/time #/world #/wrapped links redirect)
js/lib/   shared helpers for pages (stats, pool, newEpisodes, discover-lists, play)
functions/api/rd/[[path]].js   Cloudflare relay   ·   dev-server.mjs   local server + the same relay
tools/    shot.mjs (screenshots / smoke tests), build.mjs (dist for deploy), icons.mjs
```
Conventions for contributors are in [CONVENTIONS.md](CONVENTIONS.md). Open `#/kit` (localhost only) to see the living style guide.

## Integrations (all optional)
- **Sync:** automatic, no setup: every device with the same Real-Debrid key shares one blob in Cloudflare KV (`functions/api/sync.js`), keyed by the RD account id and encrypted at rest when `SYNC_SECRET` is set. Merges item by item, newest wins. The RD key never syncs or gets stored.
- **Played on your other devices:** a Home shelf built from your RD downloads history (last 30 days); works without KV.
- **Premium expiry notice** on Home when Real-Debrid premium is about to run out.
- **Trakt:** scrobbles what you watch and imports watched history and your watchlist. Tokens are kept per profile in IndexedDB. `functions/api/trakt` relays only the OAuth calls.
- **Stremio addons:** add extra source addons by manifest link. Only their JSON is read (torrent streams); `functions/api/addon` relays addons that don't send CORS headers.
- **New-episode notifications** for shows you follow.

Setup for the server side (KV binding, Trakt app) is in [DEPLOY.md](DEPLOY.md#optional-extras). Tests: `node tests/integrations.test.mjs`.
