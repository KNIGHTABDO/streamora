# Browser MKV Playback and iOS Zoom Fix Implementation Plan

> **For the implementer (GPT 6.1 Sol via Codex):** work through the tasks in order and tick the checkboxes. Read `CONVENTIONS.md` first. Claude reviews your diff afterwards, so finish with the report described under "Final report".

**Goal:** Selecting an MKV source plays it in a desktop browser on the TorBox Essential plan, double-tapping in the iOS app never zooms the UI, and the rest of the app gets a report-only audit.

**Architecture:** TorBox refuses `stream/createstream` on Essential, but its CDN permits cross-origin Range requests. So the browser remuxes on the client: Mediabunny reads the MKV over HTTP ranges, copies the video unchanged, copies or converts the audio, and writes fragmented MP4 into Media Source Extensions (MSE). No server relays video. The iOS zoom fix is web-only CSS and viewport work, because the app loads the live site.

**Tech Stack:** Preact + htm with no bundler, native ES modules, `vendor/` for libraries, Mediabunny 1.65.0, `@mediabunny/ac3` 1.65.0, `node:test`, puppeteer-core.

**Spec (the user's request):**
1. Number one: "browser watching" must work for MKV titles. Today, selecting one fails.
2. iOS app: double-tapping the screen quickly zooms in and ruins the UI. Fix it.
3. See if anything else needs fixing.

## Verified facts (tested 2026-11-01 against the real account)

| Fact | Result |
|---|---|
| `stream/createstream` on this plan | HTTP 500 `PLAN_RESTRICTED_FEATURE` |
| CDN GET with `Origin` + `Range` | 206, `access-control-allow-origin` echoes our origin |
| CDN preflight | 200, allows the `range` header and GET/HEAD |
| CDN tail range (for MKV Cues) | 206 |
| Test file in the account | "Daily Dose of Sunshine S01E01.mkv", 2.96 GB, H.264 video, AC-3/E-AC-3 audio, S_TEXT subtitles |
| AC-3/E-AC-3 in Chrome/Firefox | No decoder, so `@mediabunny/ac3` (WASM) is required |
| DTS / TrueHD | No decoder available, so such a track is unplayable |
| Baseline `npm test` | Passes |

## Global Constraints

- **Do not run `git commit`, `git push`, or any deploy.** Leave all work uncommitted in the working tree on branch `torbox` for review.
- **Never print, log or read into your own output** the contents of `tools/.tbkey` or any `tb-cdn` URL. Scripts may read the key themselves. Do not send it anywhere except TorBox.
- No video through Cloudflare, no new server functions, no bundler, no npm dependency in the root `package.json`.
- Do not change `app/plugin` Swift code. Nothing here may require a new `.ipa`.
- Do not add or delete torrents in the TorBox account. Test only with what is already there.
- This laptop freezes under heavy load: no big builds, no recursive scans of `node_modules`, and keep each browser test under 3 minutes.
- Keep the existing plain-language tone in user-facing text. Do not refactor code the tasks don't name.

## Review Focus

Each of these has its test in the owning task.

1. **The file's only audio is DTS or TrueHD:** the source fails cleanly and the next source is tried. It never plays silently. (Task 1 unit test, Task 2 ranking)
2. **Rapid scrubbing (several far seeks within a second):** only the last seek wins, with no stale data appended and no error. (Task 1 e2e)
3. **Resuming at a saved position (`start` > 0):** playback starts there, not at 0. (Task 1 e2e)
4. **Leaving the player during loading or playback:** conversion and fetches stop, with no error from a removed SourceBuffer. (Task 1 e2e)
5. **Non-MKV files the browser can't play (`.avi`, `.wmv`):** still a clean `webplan` error, never handed to the remux engine. (Task 2 test)

---

### Task 1: The MKV engine

**Files:**
- Create: `vendor/mediabunny.min.mjs`, `vendor/mediabunny-ac3.min.mjs`, `vendor/mediabunny-LICENSE.txt`
- Create: `js/player/mkv-plan.js` (pure logic, importable in Node)
- Create: `js/player/mkv.js` (browser engine)
- Create: `tools/mkvtest.mjs` (e2e)
- Modify: `index.html` (import map before the module script at line 42)
- Test: `tests/mkv.test.js`

**Interfaces:**
- Produces, in `js/player/mkv-plan.js`:
  - `canRemuxMkv(): boolean`: true when `typeof window !== 'undefined'` and `window.MediaSource || window.ManagedMediaSource` exists.
  - `hevcInMse(): boolean`: that source type supports `video/mp4; codecs="hvc1.1.6.L120.90"`; false outside a browser.
  - `planAudio(tracks, prefLang, encodeTarget)`: see Step 1.
- Produces, in `js/player/mkv.js`:
  - `attachMkv(video, url, { start = 0, audioLang, onFatal }) -> Promise<detach()>`, the same contract as `attach` in `js/player/engine.js`. It rejects with an `Error` carrying `.code` of `mkvvideo` or `mkvaudio` when the file can't play here.

- [x] **Step 1: Write the failing test** in `tests/mkv.test.js` for `planAudio`.

`tracks` items are `{ id, codec, languageCode, canDecode, mseOk }`. `encodeTarget` is `'opus' | 'aac' | null`. The return is `{ id, mode: 'copy' | 'transcode' | 'none', codec? }`, or `null` when nothing can play.

```js
const aac = { id: 1, codec: 'aac', languageCode: 'eng', canDecode: true, mseOk: true };
const eac3 = { id: 2, codec: 'eac3', languageCode: 'ara', canDecode: true, mseOk: false };
const dts = { id: 3, codec: 'dts', languageCode: 'eng', canDecode: false, mseOk: false };
assert.deepEqual(planAudio([aac, eac3], 'eng', 'opus'), { id: 1, mode: 'copy' });
assert.deepEqual(planAudio([aac, eac3], 'ara', 'opus'), { id: 2, mode: 'transcode', codec: 'opus' });
assert.deepEqual(planAudio([dts, eac3], 'eng', 'opus'), { id: 2, mode: 'transcode', codec: 'opus' }); // playable beats preferred language
assert.equal(planAudio([dts], 'eng', 'opus'), null);          // Review Focus 1: never silent
assert.equal(planAudio([eac3], 'ara', null), null);           // no encoder available
assert.deepEqual(planAudio([], 'eng', 'opus'), { id: null, mode: 'none' }); // a file with no audio is fine
assert.deepEqual(planAudio([aac, eac3], 'fre', 'opus'), { id: 1, mode: 'copy' }); // no language match: first playable
```

Also assert `canRemuxMkv() === false` in Node.

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test tests/mkv.test.js`. Expected: FAIL (module not found).

- [x] **Step 3: Implement `js/player/mkv-plan.js`**, then rerun the test. Expected: PASS.

- [x] **Step 4: Vendor the libraries**

In a temp directory outside the repo, run `npm pack mediabunny@1.65.0 @mediabunny/ac3@1.65.0`. Copy `dist/bundles/mediabunny.min.mjs` and `dist/bundles/mediabunny-ac3.min.mjs` into `vendor/`, and copy the MPL-2.0 license text. `mediabunny-ac3` has a bare `from "mediabunny"` import, so add to `index.html` before the module script:

```html
<script type="importmap">{"imports":{"mediabunny":"./vendor/mediabunny.min.mjs"}}</script>
```

Always load the library with `import('mediabunny')`, so there is one module instance. Load both lazily, only when an MKV plays, never from `main.js` or the service worker's `SHELL`.

- [x] **Step 5: Implement `attachMkv` in `js/player/mkv.js`**

Decisions already made:

- **Input:** `new Input({ source: new UrlSource(url, { getRetryDelay: n => (n <= 3 ? n : null) }), formats: [MATROSKA] })`. Check the option name in Mediabunny's `.d.ts`.
- **Video:** primary track. Build `video/mp4; codecs="<getCodecParameterString()>"`. If unsupported by `MediaSource.isTypeSupported`, reject with code `mkvvideo`. Video is always copied, never transcoded. Use a `video` option in the Conversion that keeps the track's own codec.
- **Audio:** if any track is `ac3`/`eac3` and the browser's MSE lacks `ec-3`, `import('./../../vendor/mediabunny-ac3.min.mjs')` and call `registerAc3Decoder()` once before calling `canDecode()`. Build the `planAudio` input from real tracks. `encodeTarget` is the first of `opus`, `aac` where `canEncodeAudio(codec)` is true and MSE accepts it in MP4. A `null` plan rejects with code `mkvaudio`. `transcode` means `{ codec, numberOfChannels: 2, bitrate: 192000 }`. Every other audio track gets `{ discard: true }`.
- **Output:** `new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 2 }), target: new StreamTarget(writable) })`, driven by `Conversion.init({ input, output, video, audio, trim })`. Check `conversion.isValid`, and treat `false` as `mkvvideo`.
- **MSE:** `const MS = window.MediaSource || window.ManagedMediaSource`. When only `ManagedMediaSource` exists (iPhone Safari), set `video.disableRemotePlayback = true`. Use one muxed SourceBuffer, `mode = 'segments'`, created from `await output.getMimeType()`. `video.src = URL.createObjectURL(ms)`. Set `ms.duration` from `input.getDurationFromMetadata()`, falling back to `computeDuration()`.
- **Backpressure:** the WritableStream's `write` is async and waits for `updateend`, so slowness propagates to the Conversion and on to the network. Before appending, wait while more than 60s is buffered ahead of `currentTime`. This also stops downloading while paused.
- **Eviction:** after appends, remove everything older than `currentTime - 60`. On `QuotaExceededError`: remove up to `currentTime - 10`, wait until less than 20s is buffered ahead, then retry the same chunk (needed for big 4K files).
- **Starting or seeking to time `t`:**
  1. Find the keyframe with `new EncodedPacketSink(videoTrack).getKeyPacket(t)`. Use its timestamp as `keyTs` (0 if null).
  2. Start a Conversion with `trim: { start: keyTs }`, so video and audio both begin on that keyframe.
  3. Set `sourceBuffer.timestampOffset` so output times equal the file's real times. Verify whether Conversion rebases to 0 and set the offset accordingly. The e2e test proves it.
  4. Once `canplay` fires or `t` is buffered, ensure `video.currentTime = t`.
- **Seeks (`seeking` event):** do nothing if `t` is inside a buffered range, or within 15s after the end of the buffer while a Conversion is running (it's coming anyway). Otherwise debounce 150ms, bump a generation counter, `await conversion.cancel()`, `sourceBuffer.abort()`, remove all buffered data, and start again at `t`. Every write checks its generation and drops stale chunks. Serialize restarts so two can't overlap. Swallow cancellation errors. Ignore the engine's own `currentTime` writes from step 4 above.
- **End of file:** when `execute()` resolves for the current generation, call `ms.endOfStream()` so `ended` fires. A seek after that must still work.
- **Errors:** any other error from the current generation calls `onFatal(err, video.currentTime || start)` once.
- **`detach()`:** bump the generation, cancel, dispose the Input, remove listeners, `video.removeAttribute('src')`, `video.load()`, revoke the object URL. It must be safe to call at any time, including during startup.

- [x] **Step 6: Write `tools/mkvtest.mjs`**

Model it on `tools/playtest.mjs`: same launch args, `/usr/bin/google-chrome` headless, against `http://localhost:5173` (start `node dev-server.mjs` first, stop it after). Inside the page, find the first `.mkv` in the account through `/api/tb/torrents/mylist`, mint a link through `/api/tb/torrents/requestdl`, create a `<video muted>`, and call `attachMkv` directly. Print only pass/fail lines and numbers, never URLs.

Assert, in order:
1. `start: 120`: within 30s `currentTime` is in 120..125 and advancing; `webkitAudioDecodedByteCount > 0` (Review Focus 3).
2. Plays 10s; `currentTime` advances about 10s.
3. Far seek to 50% of duration: within 25s, `currentTime` is within 2s of the target and advancing.
4. Seek back to 60s: same check.
5. Three seeks 200ms apart (20%, 70%, 40%): settles at 40% ± 2s and plays (Review Focus 2).
6. Seek to 20s before the end: `ended` fires within 60s.
7. New attach, `detach()` after 500ms during startup, then a new attach that plays (Review Focus 4). No `pageerror` or `console.error` in the whole run.

- [x] **Step 7: Run it**

Run: `node tools/mkvtest.mjs`. Expected: all 7 PASS. If Chrome can't launch or reach the network from your sandbox, say so in the final report. Do not fake it. Claude will run it outside the sandbox.

---

### Task 2: Wire MKV into the app

**Files:**
- Modify: `js/core/tb.js:136-166,193`
- Modify: `js/player/engine.js:48-68`
- Modify: `js/player/player.js:104,158`
- Modify: `js/core/sources.js:101-117`
- Modify: `js/pages/watch.js:35,77`, `js/pages/detail.js:28`
- Modify: `README.md:60`
- Test: `tests/integrations.test.mjs`, `tests/mkv.test.js`

**Interfaces:**
- Consumes: `canRemuxMkv`, `hevcInMse` from `js/player/mkv-plan.js`; `attachMkv` from `js/player/mkv.js`.
- Produces: `resolveStream` result gains `remux: boolean`. `attach(video, url, { start, onFatal, remux, audioLang })`. `rankStreams` prefs gain `remux: boolean`, `avoidHevc: boolean`. `sources.js` exports `webPrefs(): { preferMp4, mp4First, remux, avoidHevc }`.

- [x] **Step 1: Write the failing tests**

In `tests/integrations.test.mjs`, using its existing fetch mock, with createstream refused:
- `globalThis.window = { MediaSource: function () {} }`: resolving `A.2020.1080p.mkv` returns `remux === true` and a `direct` link.
- No `MediaSource` on `window`: rejects with `code === 'webplan'`.
- With `MediaSource`, a `.avi` file: rejects with `code === 'webplan'` (Review Focus 5).
- `direct: true` with an MKV: `remux === false`.
- With a mocked `hls_url`: `hls` is set and `remux === false`, so paid plans keep TorBox streaming.
- The gate at `tb.js:193` doesn't throw for a known `.mkv` filename when streaming was already refused and `canRemuxMkv()` is true.

Restore `window` after these tests.

In `tests/mkv.test.js`, for `rankStreams` with two otherwise identical sources:
- `{ remux: true }`: `Movie.1080p.x264.AC3.mkv` outranks `Movie.1080p.DTS-HD.mkv` and `Movie.1080p.TrueHD.mkv`.
- `{ remux: true, avoidHevc: true }`: `x264.mkv` outranks `x265.mkv`.
- `{ remux: true, avoidHevc: false }`: `x265` gets no penalty.
- `{ remux: true }`: `Movie.1080p.x264.AC3.mkv` outranks `Movie.1080p.x264.EAC3.mp4`, because a plain `<video>` can't decode that MP4's audio in Chrome.
- `{ mp4First: true }` keeps its current behaviour.

- [x] **Step 2: Run them and confirm they fail**

Run: `npm test`. Expected: the new assertions FAIL and everything else passes.

- [x] **Step 3: Implement**

- `tb.js`: add `const mkvFile = name => /\.mkv$/i.test(name || '')`. In `finish`, throw `webPlanError()` only when there's no HLS, the file isn't a browser file, and not (`mkvFile` and `canRemuxMkv()`). Add `remux: !direct && !hls && mkvFile(file.path)` to the result. Apply the same exception to the gate at line 193. Reword `webPlanError`: "This file's format can't play in this browser. Pick another source, or play it in the Streamora app."
- `engine.js`: at the top of `attach`, `if (remux) { const { attachMkv } = await import('./mkv.js'); return attachMkv(video, url, { start, audioLang, onFatal }); }`.
- `player.js:104`: the last fallback becomes `stream.remux || /\.(mp4|webm|m4v)$/i.test(stream.filename || '') ? stream.direct : null`. Mind operator precedence inside the `||` chain. Line 158: pass `remux: stream.remux, audioLang: mem.audioLang || s.audioLang`.
- `sources.js`: `webPrefs()` returns `{ preferMp4: noMkv(), mp4First: noMkv() && webStreamingRefused-equivalent && !canRemuxMkv(), remux: <not native> && canRemuxMkv(), avoidHevc: <same> && !hevcInMse() }`. `mp4First` must keep today's meaning, so take `webStreamingRefused` as a parameter from callers rather than importing `tb.js` into `sources.js`. In `rankStreams`, when `prefs.remux`, using the text of `${s.filename} ${s.release}`:
  - `/\bdts\b|dts-?hd|truehd/i` → `x -= 400`
  - `prefs.avoidHevc` and `/x265|hevc|h\.?265/i` → `x -= 250`
  - MP4 and `/e?ac-?3|ddp|dd[+ .]?5/i` → `x -= 100`
- `watch.js:77` and `detail.js:28`: use `webPrefs`, and only apply it when not native. `watch.js:35`: title stays, text comes from the new message.
- `README.md:60`: say browsers now play MKV by remuxing on the client (H.264 everywhere, HEVC where the device decodes it, DTS/TrueHD not), and the app still plays everything through VLC.

- [x] **Step 4: Run the tests**

Run: `npm test`. Expected: all pass.

- [x] **Step 5: Run the whole app**

Run `tools/playtest.mjs` against the test MKV's title. Look its id up with `resolveTitle` from `js/core/meta.js`, and pass `?hash=<hash>&fn=<name>` so that exact copy plays. Use `--secs 60`. Expected: real playback through the Player UI, with no error screen. Report the numbers, never URLs.

---

### Task 3: iOS double-tap zoom

**Files:**
- Modify: `css/paper.css:114`
- Modify: `js/main.js` (near the top, after imports)
- Test: `tests/mkv.test.js` is the wrong home, so create `tests/ios-zoom.test.js`

**Interfaces:** none.

**Cause:** nothing sets `touch-action: manipulation` outside the player, and `index.html:5` allows scaling, so WKWebView's double-tap zoom is live on every page and leaves the fixed layout zoomed.

- [x] **Step 1: Write the failing test** in `tests/ios-zoom.test.js`.

Read the source files as text and assert:
- `css/paper.css` matches `/html[^{]*\{[^}]*touch-action:\s*manipulation/`.
- `css/paper.css` applies `touch-action: manipulation` to `a`, `button`, `input`, `select`, `textarea`, `label`, `[role="button"]`.
- `js/main.js` contains `user-scalable=no` and `gesturestart`.
- `css/player.css` still has `touch-action: none` on `.pl-surface`, so the player's own double-tap seek keeps working.

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test tests/ios-zoom.test.js`. Expected: FAIL.

- [x] **Step 3: Implement**

- `css/paper.css`: add `touch-action: manipulation` to `html`, plus a low-specificity rule for the interactive elements listed above. Don't use `!important`. Existing `pan-y` and `none` rules in `watchlist.css`, `wrapped.css`, `mood.css`, `player.css` must keep winning.
- `js/main.js`, only inside the app (`window.Capacitor?.isNativePlatform?.()`), so browser visitors keep pinch zoom for accessibility:
  - Append `, maximum-scale=1, user-scalable=no` to the viewport meta content.
  - `document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false })`.
  - Add class `native-app` on `<html>`.
- `css/paper.css`: `html.native-app { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }` with `html.native-app input, html.native-app textarea { -webkit-user-select: text; user-select: text; }`, so fast tapping doesn't select text or pop callouts.

- [x] **Step 4: Run the tests**

Run: `npm test`. Expected: all pass. Make sure `tests/ios-zoom.test.js` is matched by the `tests/*.test.js` glob.

The real check needs a real iPhone, so note that in the final report as not verified.

---

### Task 4: Audit (report only)

**Files:**
- Create: `docs/audit-2026-11-01.md`

- [x] **Step 1: Audit, changing no code**

Read `js/pages/watch.js`, `js/player/player.js`, `js/player/native.js`, `js/core/tb.js`, `js/core/sync.js`, `js/lib/update.js`, `js/main.js`, `functions/api/tb/[[path]].js`, `sw.js`, `_headers`, `.github/workflows/ios.yml`.

Look for real, reachable bugs and iOS-app performance problems. Candidates worth checking:
- Leftover Real-Debrid-era dead code around `info`, `modelUrl`, `isTc` in `player.js`, and which menus it leaves empty on the web.
- Embedded MKV subtitles in the browser player. They aren't extracted, so what does the user see?
- CDN links expiring after a long pause.
- Backdrop-filter or large paint costs on phones.
- Whether the Update popup fetches too often.

- [x] **Step 2: Write the report**

For each finding: severity (high/medium/low), `file:line`, one sentence on what a user would experience, one sentence on the fix. Most severe first, at most 15 findings, no style complaints. Mark anything you didn't actually confirm in code as "unconfirmed".

---

## Final report

End with a short message containing: what was done per task, the exact `npm test` and `tools/mkvtest.mjs` results (pass/fail per assertion), any place you departed from this plan and why, and anything not verified. Do not claim something passed unless you saw it pass in this session.
