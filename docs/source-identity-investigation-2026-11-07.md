# Wrong film under The Odyssey (2026): investigation

Investigation date: 2026-11-07. This records the initial diagnosis, before implementation. The subsequent [fix and validation report](source-identity-fix-2026-11-07.md) describes the local implementation. Deployment status is recorded in the subsequent release notes.

## Finding

The selected catalog entry is correct: IMDb `tt33764258`, Christopher Nolan, Matt Damon, 173 minutes. The source search for that exact ID returns a mixture of adaptations, including multiple 86-minute files with the same title and year. Streamora accepts these results without validating the identity of the actual video.

This was verified against the existing TorBox account, not inferred solely from the screenshots. Four already-owned releases were inspected with read-only list/download-link requests and `ffprobe`. No torrents were added or deleted. All four files have the exact duration **5163.456 seconds = 1:26:03.456**:

| Release | Torrent hash | Video | Measured seconds |
| --- | --- | --- | ---: |
| AMZN WEB-DL x265 Celdra | `f4f90193e557adfdf14ff70d4806213450dd4ea0` | MKV | 5163.456 |
| AMZN WEB-DL H.264 Kitsune | `51090985c585df1a327817b37e9e8f0444c69279` | MKV | 5163.456 |
| WEBRip x264 YTS | `9a9ce48211d95a42e2379c155c7c58604b4f5893` | MP4 | 5163.456 |
| WEBRip x265 LAMA | `65bc1ac278692af1e69408c565c8e31f5090713d` | MP4 | 5163.456 |

The Kitsune and LAMA NFO sidecars independently say `Duration: 1 h 26 min`. Each torrent contains one main video, and its filename matches the advertised filename. Thus the largest-file fallback is **not needed to explain this incident**. The wrong film is already the advertised file.

The shorter files are consistent with the separate Asylum/Marcel Walz adaptation, IMDb `tt41605854`, also named The Odyssey (2026). Its catalog runtime is 86 minutes; its cast and director differ. The Asylum's own [title page](https://theasylum.cc/index.php/titles/detail?id=517) identifies Marcel Walz, and its [Film Catalogue listing](https://www.thefilmcatalogue.com/films/the-odyssey) supplies the 86-minute runtime. End credits sampled from the YTS file include colorist Matt Lear and sound mixer Martin Chappell, consistent with the shorter film's credits.

For comparison, the intended film's [official studio page](https://www.universalpicturesathome.com/movies/the-odyssey-2026) identifies Nolan and Damon. The live Cinemeta metadata at `/meta/movie/tt33764258.json` supplies the 173-minute runtime shown in the user's screenshot.

## Live source evidence

Public source searches were made without transmitting the account key to addons:

- `https://torrentio.strem.fun/sort=qualitysize/stream/movie/tt33764258.json`: 50 results at inspection time. The list includes the already-owned Kitsune, YTS and LAMA hashes above. It also includes a 2025 Odyssey prologue.
- `https://meteorfortheweebs.midnightignite.me/stream/movie/tt33764258.json`: 62 results at inspection time. The list mixes explicit Asylum filenames, short WEB-DLs and longer claimed releases.
- Meteor supplies `behaviorHints.duration: 5163` for the **exact owned Celdra hash**. Other files carry `10356` seconds (172:36), or explicit Asylum labels with `4950` seconds. These are provider claims, not independent verification of the longer files.
- One returned release is literally named `The Odyssey 2026 NOT The Chris Nolan FILM ...`, with a duration hint of 5163 seconds.

The upstream association to Nolan's ID is wrong for at least these short files. These observations do not establish which indexer first introduced the bad association, whether it was deliberate, or which of the four the phone played at the instant of the screenshot. They do establish why switching among these four releases cannot produce Nolan's film. Their identical durations alone do not prove identical bytes or encodes.

## Code paths that permit it

1. **Discovery trusts the response bucket.** `js/core/sources.js:64` requests streams for the canonical ID, but neither discovery nor `rankStreams` receives the expected title metadata for comparison. Requesting a correct ID does not make every returned hash correct.
2. **Available evidence is discarded.** `normalizeStream` in `js/core/addons.js:69` preserves only filename and binge group in `behaviorHints`; it drops Meteor's duration. `parseStream` in `js/core/sources.js:20` also has no duration field. Both addon merging (`addons.js:173`) and cross-provider merging (`sources.js:98`) retain the first row and mostly update cache flags, rather than merging identity evidence.
3. **Availability and format determine ranking.** `sources.js:173` ranks cache readiness, resolution, container, language, file size and seeds. These can prefer an easy-to-play, small wrong movie over a larger correct candidate. `watch.js:115` further promotes suitable already-owned copies. Neither is proof of content identity.
4. **Resolution has no expected identity.** `watch.js:154` passes hash, filename, file index and episode coordinates to `resolveStream`; it does not pass the movie's canonical ID, expected runtime or edition. TorBox then serves the requested hash/file.
5. **Playback never compares actual duration to expected duration.** `player/player.js:222` observes loaded metadata, but does not reject a 86-minute file under a 173-minute title. Web, VLC-backed UI and classic native playback need the same validation policy.
6. **Resume can pin the mistake.** `player/player.js:247` and `player/native.js:62` save the source under the selected title; `lib/play.js:36` puts it back into the watch URL. `watch.js:123` accepts that pinned hash even if current discovery no longer returns it. `tb.js:246` also reuses persisted file choices without checking content identity.

TorBox's cached flag means a file is ready, not that it matches the requested movie. This incident is not explained by changing codecs, subtitles, or browser cache.

## Separate, reproduced risk for shows and packs

`pickFile` in `js/core/tb.js:150` tries filename, then episode, then file ID, then the largest file. It also falls back to non-video files if there are no eligible videos. Running the actual function confirmed:

| Request | Available files | Current result |
| --- | --- | --- |
| S01E02 | S01E03 (9 GB), S01E04 (2 GB) | S01E03 |
| `Expected.Movie.2026.mp4` | `Other.Movie.2025.mp4` | Other movie |
| Video with no filename | `README.txt` only | README.txt |

An exact filename currently wins even if its episode conflicts with the requested episode. `ownedFile` is stricter for speculation, but normal playback still uses the permissive selector.

There is also an observed index mismatch: Torrentio advertises `fileIdx: 0` for Kitsune, while TorBox's main video has `id: 2` and ID 0 is its NFO. Filename matching selects the correct video here. Addon file indices must not be assumed interchangeable with TorBox file IDs. A repair must validate the selected path and episode rather than relying on a numeric match.

## Repair design

The reusable change is a validation stage before format/quality ranking, with a second check on the resolved file. A title/year filter alone cannot fix this case because both films share both values.

1. **Carry the requested identity throughout playback.** Use canonical provider ID, media type, episode ID/season/episode where applicable, expected names and aliases, year, and edition-specific runtime when available. Keep metadata provenance. A series-wide average runtime is not an authoritative runtime for every episode. Anime absolute numbering needs explicit mapping, not guessed season numbers.
2. **Preserve source evidence and provenance.** Normalize finite positive durations in documented units, explicit source IDs when provided, filename, and provider name. Merge evidence for the same torrent/file across providers, including late arrivals. Conflicting evidence must remain visible. Do not equate an ID echoed by the queried endpoint with independently verified file identity.
3. **Reject clear conflicts before automatic selection.** Wrong explicit content IDs, wrong years with reliable parsing, contradictory episode numbers, and trailers/prologues/extras should not become fallback candidates. Allow known aliases and edition differences. Use addon runtime hints to screen obvious mismatches early; do not use those untrusted hints as final proof.
4. **Make file selection strict.** If the requested episode or advertised file cannot be established, return `content_mismatch` or `episode_missing`. Never silently choose another episode, a different movie, a sample or a non-video file. An unambiguous single video may still proceed to identity validation; a collection requires a matching file. Validate filename and episode together.
5. **Probe actual media metadata before committing playback.** MP4/WebM can use browser metadata; MKV can use the existing media parser; native playback needs an equivalent paused metadata probe, including classic native mode. Avoid downloading entire videos or routing video through a server. Compare actual duration with trustworthy movie/episode/edition metadata using a documented tolerance. An 86-minute file against 173 minutes is a decisive mismatch. Missing duration is unknown, never automatically a match. Unknown identity needs a deliberate user choice if strict automatic playback is required.
6. **Apply the same gate to every entry path.** Automatic playback, detail source selection, watch source selection, pinned URLs, Resume, next episode, existing account files used for catalog playback, prefetched links, and remembered resolutions must all pass validation. A content mismatch must not trigger a codec fallback to VLC for the same bad file. An explicit library file opened without a catalog identity can retain its direct-file behavior.
7. **Remember decisions against the correct scope.** Cache validation/rejection by requested canonical title/episode + torrent hash + actual file ID/path/size + validator version. A file rejected for Nolan's title may be valid for the Asylum title. A bad episode file must not blacklist an entire season pack. Expire and revalidate stale evidence. Bump the old resolution-cache schema so legacy unvalidated choices cannot bypass the gate. Existing remembered sources must be rechecked; do not erase the user's whole library/history.
8. **Keep progress and history accurate.** Only bind a source, save progress or scrobble after validation. Invalidate affected Resume bindings when a mismatch is found. Old progress/history may already refer to the wrong film, so provide a targeted reset rather than automatically deleting user data. A late source rejection must stop playback and suppress cleanup saves before trying another candidate.
9. **Explain failures and retain diagnostics.** Show `Wrong film: this copy is 86 min; expected about 173 min`, reject it for the current title, then try another eligible candidate. If none passes, show `No matching source found`. Log expected ID/episode, provider, hash/file identity, measured/expected duration, validation result and reason. Never log keys or signed playback URLs. Surface runtime and match status in source pickers.

The strongest practical guarantee is to refuse silent automatic substitution when identity is conflicting or unverified. Runtime and filenames are safeguards, not a universal content fingerprint: a mislabeled film can have the same duration. Stronger positive identity needs trustworthy file-to-title mappings or content fingerprints. Provider agreement alone is insufficient because providers can index the same mistaken release.

## Regression cases required for implementation

- Two films with identical name and year but distinct IDs and 173/86-minute runtimes; include all four measured releases above as fixtures.
- Duration survives normalization, parsing, both deduplication layers and a late addon response; conflicting hints stay conflicts.
- Correct title/year/filename with wrong actual duration; absent hints must still be caught by the actual probe.
- Missing metadata/probe failure, legitimate alternate cuts, localized titles, re-releases, short films, and per-episode runtimes.
- Requested episode absent from a pack; conflicting filename vs episode; specials, absolute-numbered anime, and double episodes.
- Addon file index differs from TorBox ID; no eligible video; multiple movie collection; samples/extras only.
- Remembered wrong source and old resolved cache, including when the provider stops returning that source.
- Same torrent legitimately serves several episodes/titles; rejection of one must not contaminate another.
- Browser MP4, browser MKV remux, VLC engine and classic native; no progress, scrobble or codec fallback after content rejection.
- All candidates rejected; partial late results; abort on leaving; validation does not add torrents during speculative prefetch.

## Verification performed

- Live Cinemeta and public addon queries for the intended ID and alternate catalog entries.
- Read-only account listing, NFO reads and independent `ffprobe` measurements of the four already-owned videos.
- Small credit-frame samples from one owned video; no complete video download was required.
- Local calls to the actual `normalizeStream`, `parseStream`, `rankStreams` and `pickFile` functions reproduced the discarded duration, ranking of bad candidates, and unsafe file fallbacks.
- `npm test`: **107/107 tests pass**, plus parser self-check and integration/MKV-fallback checks. The passing suite currently lacks the content-identity cases listed above.

At the end of this initial investigation only this report had been added. The subsequent implementation is documented in the [fix and validation report](source-identity-fix-2026-11-07.md). No sources were deleted during the investigation.
