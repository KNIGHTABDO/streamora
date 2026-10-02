# Streamora ✎

A sketchbook that plays movies. Streamora is a bring-your-own-key streaming app powered by **Real-Debrid**. It has hand-drawn everything and multiple profiles. You sign in with Google, and all of your data is kept in a "Streamora" folder in **your own Google Drive**, so every device stays in step.

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
| Google Drive | one gzipped file (`Streamora/streamora-data`, `drive.file` scope) holds profiles, progress, history, diary, settings, the RD key and Trakt sign-ins (`js/core/sync.js`) |
| `functions/api/google` | finishes Google sign-in (the token calls need the client secret). It stores nothing |

The video never goes through the relay: it streams from Real-Debrid's servers directly. HLS plays natively on iPhone/Safari and through hls.js everywhere else, which is why mkv/HEVC/EAC3 files still play on an iPhone.

## Privacy
- Everything is saved in the signed-in Google account's Drive, in a "Streamora" folder (`drive.file` scope: Streamora only sees files it created; the hidden appdata folder isn't allowed for TV/code sign-in). Nothing is kept on Streamora's servers. Public policy page: `privacy.html`.
- Each device keeps a local copy in `localStorage` so the app is instant and works offline; the RD key is AES-GCM encrypted there with a non-extractable key held in IndexedDB.
- Settings → Privacy → **Delete everything from Drive** removes the file and revokes Streamora's access.
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
js/core/google.js (sign-in) · js/core/sync.js (Drive sync) · privacy.html (policy page for Google's consent screen)
functions/api/rd/[[path]].js   Real-Debrid relay   ·   functions/api/google/[[path]].js   Google sign-in relay
dev-server.mjs   local server + the same functions
tools/    shot.mjs (screenshots / smoke tests), build.mjs (dist for deploy), icons.mjs
```
Conventions for contributors are in [CONVENTIONS.md](CONVENTIONS.md). Open `#/kit` (localhost only) to see the living style guide.

## Integrations (all optional)
- **Google Drive sync:** sign in once per device (web: Google's page; TVs and the iPhone app: a code at google.com/device). Changes go up ~1.5 s after you make them; other devices' changes come in on start, when the app comes back to the front and every 45 s while it's open. A quiet check is one tiny metadata request. Lists and progress merge item by item, newest wins, deletions stick. Installs from before Drive get a one-time "move into Drive" page with no way around it.
- **Played on your other devices:** a Home shelf built from your RD downloads history (last 30 days).
- **Premium expiry notice** on Home when Real-Debrid premium is about to run out.
- **Trakt:** scrobbles what you watch and imports watched history and your watchlist. Tokens are kept per profile in IndexedDB. `functions/api/trakt` relays only the OAuth calls.
- **Stremio addons:** add extra source addons by manifest link. Only their JSON is read (torrent streams); `functions/api/addon` relays addons that don't send CORS headers.
- **New-episode notifications** for shows you follow.

Setup for the server side (Google sign-in, Trakt app) is in [DEPLOY.md](DEPLOY.md). Tests: `npm test`; end-to-end Drive sync against a fake Drive: `node tools/drivetest.mjs` (dev server running).

## iPhone & iPad app
Safari can't play mkv files, so on the web Streamora has to use Real-Debrid's live transcode, which can fall behind and buffer. The app version plays **the original file** with a built-in VLC player (mkv, HEVC, Dolby, DTS, embedded subtitles), the same way Infuse does. Everything else (profiles, Drive sync, Trakt) is the same Streamora. Inside the app you sign in with a code at google.com/device, because Google doesn't allow its sign-in page inside apps.

**Install (SideStore, refreshes itself on the device):**
1. Once per device, set up [SideStore](https://docs.sidestore.io/docs/installation/prerequisites): install LocalDevVPN from the App Store, then on the computer install `usbmuxd` and [iloader](https://github.com/nab138/iloader/releases/latest), plug the device in, and use iloader → *Install SideStore (Stable)*. Then follow the on-device steps in [their guide](https://docs.sidestore.io/docs/installation/install) (trust the profile, Developer Mode, sign in to SideStore).
2. Download `Streamora.ipa` from the [latest release](https://github.com/KNIGHTABDO/streamora/releases/latest) on the iPhone/iPad (Safari → Files).
3. In SideStore → My Apps → **+**, pick `Streamora.ipa`. Keep LocalDevVPN on when installing or refreshing. Free Apple IDs need a refresh every 7 days, which SideStore does on the device.

Sideloadly or AltStore also work: sign the same .ipa with your Apple ID.

The app loads the live site, so web updates reach it automatically; only player changes need a new .ipa. It's built by GitHub Actions (`.github/workflows/ios.yml`) from `app/`: a Capacitor shell plus the `streamora-player` plugin (`app/plugin`, Swift + MobileVLCKit). Push a tag like `v1.0.0` to publish a release.
