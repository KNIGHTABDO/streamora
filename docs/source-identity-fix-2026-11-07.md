# Source identity fix — 2026-11-07

Release v2.0.3 implements the fix from the [Odyssey investigation](source-identity-investigation-2026-11-07.md). Deployment and native build status are recorded in the GitHub release notes.

## Behavior

- Source normalization preserves duration hints, explicit IMDb IDs and provider provenance. Duplicate rows merge evidence without mutating already-published snapshots. Different files in a torrent keep separate evidence.
- Automatic and manual catalog playback reject explicit title-ID, release-year, episode, preview/extra and large runtime contradictions. Source pickers disable rejected copies, explain the reason and put selectable copies first.
- The runtime check uses metadata loaded by the existing player, including MP4, MKV remux and the VLC adapter. It does not open a second video or fetch a second metadata copy. A mislabeled 86-minute video under the 173-minute Odyssey entry stops and advances to another eligible source.
- File selection no longer falls back to the largest movie/episode or to a non-video. An ambiguous movie collection needs the advertised filename. Requested episodes must match the filename evidence; a contradictory episode marker cannot be overridden by an addon file index. Addon indices are not treated as TorBox file IDs.
- Resume URLs, direct source selection, remembered resolutions, owned files used for catalog playback and next-episode prefetch use the same checks. The old `tb1` file-choice cache cannot bypass the new selection rules (`tb2`). Direct library playback without a catalog identity remains available.
- Rejected playback cannot save progress or emit playback scrobbles, including synchronous pause/close callbacks and unmount cleanup. A content mismatch does not retry the same movie through the app's VLC codec fallback.
- Known bad Resume bindings are removed, and affected progress is marked so it does not resume or skip to the next episode. History and unrelated episodes/files are preserved. Manual "mark watched" records with synthetic 100-second durations are not mistaken for real media metadata.
- Rejections are bounded to 100 device-local entries for seven days, scoped to requested title/episode, filename, hash and expected runtime. Changing the expected runtime rechecks the source. A rejection under Nolan's ID does not blacklist the file for its actual title or another file in the same pack.
- Late addons can rescue an exhausted search, while healthy playback continues uninterrupted.

The shared checks live in `js/lib/source-identity.js` and `js/lib/source-validation.js`. Core changes are limited to preserving evidence, strict file selection, cache versioning and ignoring invalidated progress.

## Smoothness

The source discovery deadline/grace window is unchanged. An owned MP4 still resolves with one TorBox `requestdl` call. Speculation remains read-only; it does not add torrents or probe media. There is no new dependency, interval, frame scan or video proxy.

The playback guard checks when duration metadata changes, then allows normal time updates without running identity matching. A unit test dispatches 500 time updates and verifies the duration is read once. Source-list matching occurs at discovery/selection boundaries rather than during video frames.

Measured with a deterministic browser harness, synthetic videos, mocked provider/account responses and Chrome at **4× CPU slowdown**, comparing the previous `HEAD` against the fix:

| Measurement | Before | After |
| --- | ---: | ---: |
| Median tap → playing, six runs each | 819 ms | 723 ms |
| UI animation-frame interval, p95 during playback | 16.7 ms | 16.8 ms |
| Long tasks during the three-second playback sample | 0 | 0 |
| Playback advanced during that sample | 3.01 s | 3.02 s |

These measurements show no regression in the controlled comparison. Startup timings vary between runs; the apparent improvement is not a promise of faster TorBox/network responses. The animation-frame measurement describes UI scheduling, not the frame rate of a real film. The synthetic videos have low frame rates and intentionally different container runtimes.

A separate Node measurement of 1,000 source checks took about 4.4 ms median over 100 repetitions. This is a desktop measurement, not a phone guarantee.

## Validation

- `npm test`: **128 tests passed**, plus parser self-check and integration/MKV-fallback checks.
- `node tools/build.mjs`: successful; both shared modules are included in the generated service-worker shell/preload graph as needed.
- `node tools/source-identity-smoke.mjs`: seven full-app browser scenarios passed with no page errors: known hint mismatch, missing episode, wrong actual runtime without hints, all copies rejected, bad Resume, VLC adapter, and classic native bridge.
- Browser checks verify known mismatches never request download links, rejected playback never saves or scrobbles, valid playback starts, and wrong source buttons are disabled. The missing-episode scenario never mints a link for the wrong episode.
- Desktop Ink source-picker, phone Ink source-picker and phone Blueprint error screenshots were inspected.
- `git diff --check`: clean.

The browser harness is self-contained and never calls a real account. It creates tiny synthetic MP4s under `/tmp/streamora-source-identity-smoke`, mocks source/TorBox/Google responses, and writes screenshots there. Optional comparison:

```sh
PORT=5187 node dev-server.mjs
node tools/source-identity-smoke.mjs --base http://localhost:5187 --baseline http://localhost:5188
```

The baseline argument expects a server running the previous checkout. It is optional for functional smoke checks.

## Native and remaining limits

The JavaScript checks cover the installed VLC engine and classic progress events. A six-line Swift change emits classic-player duration metadata at its first available timer tick, rather than waiting for the next progress report. That earlier classic callback requires a rebuilt IPA. Existing IPAs retain the progress-event fallback.

Native behavior was exercised through a fake Capacitor bridge in Chrome and unit tests. The native change also compiled and packaged successfully on the GitHub Actions macOS runner. The v2.0.3 IPA is attached to the release; real iPhone/iPad playback still needs device testing.

Runtime is compared with a 20% tolerance and a small absolute allowance for rounding, credits and speed changes. Explicit extended/director's/unrated cuts permit larger increases, while an 86-minute file against 173 minutes still fails. Series-wide average runtime is deliberately not used as an exact episode duration; per-episode runtime is used when supplied. Missing metadata remains unknown, rather than positive proof of identity.

These checks prevent detected contradictions and unsafe substitutions. They are not content fingerprinting: a mislabeled film with the same name, year and plausible runtime can still evade metadata checks. This work does not verify that any live 173-minute source is the genuine Nolan film.

## Production deployment

- Source fix committed to `main` as `501d151`, tagged `v2.0.3`.
- Website: https://streamora-5w5.pages.dev, version 2.0.3, shell build `646c61458ead`.
- Deployment: https://86859493.streamora-5w5.pages.dev.
- All seven mocked playback scenarios passed against production-served app assets with no page errors. Live version and both validation modules were checked after deployment.
- Native build and release: https://github.com/KNIGHTABDO/streamora/actions/runs/42378165198. All build/package/release steps passed.
- iPhone release: https://github.com/KNIGHTABDO/streamora/releases/tag/v2.0.3. The unsigned IPA still needs installation/signing through SideStore, AltStore or Sideloadly.
- A follow-up test-fixture change awaits the actual hidden-sync promise rather than a fixed number of microtasks, resolving the Node 20 CI timing failure without changing application runtime code.
