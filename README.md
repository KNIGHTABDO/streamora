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
js/pages/ one file per section (home, detail, watch, movies, shows, anime, myrd, search, mood, …)
js/lib/   shared helpers for pages
functions/api/rd/[[path]].js   Cloudflare relay   ·   dev-server.mjs   local server + the same relay
tools/    shot.mjs (screenshots / smoke tests), build.mjs (dist for deploy), icons.mjs
```
Conventions for contributors are in [CONVENTIONS.md](CONVENTIONS.md). Open `#/kit` to see the living style guide.
