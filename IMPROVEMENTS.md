# BrowSDR — Possible Improvements

> Generated on 2026-04-26 from a static analysis of the codebase.
> Last updated: 2026-05-01 — points 1–16 addressed.

---

## Critical

1. ✅ **Near-zero test coverage** — Added `vitest.client.config.ts` + jsdom environment. New test suites: `test/client/dsp-pipeline.spec.ts` (25 tests), `test/client/state.spec.ts` (13 tests), `test/client/computed.spec.ts` (20 tests), `test/client/validation.spec.ts` (21 tests), `test/client/webrtc-backoff.spec.ts` (7 tests). `package.json` gained `test:client` script.

2. ✅ **Fragmented error handling** — Created `src/client/logger.ts` (`logError`/`logWarn`/`logInfo`). Fixed WASM init silent-swallow bug in `dsp-worker.ts` (re-throws so the promise rejects and posts an error message). Replaced silent `catch (e) {}` in `settings.ts` and `bookmarks.ts` with `logWarn`. Standardised all driver transfer-error tags to `[BrowSDR:X]` prefix.

---

## High Priority

3. ✅ **Monolithic state** (`app/state.ts`) — Split into `remoteSlice()`, `vfoSlice()`, `bookmarkSlice()` helpers. Added typed interfaces (`RemoteClientEntry`, `DevicePickerEntry`, `VfoActivityStat`, `DspStats`) in `app/types.ts`. Eliminated `null as any` / `[] as any[]` casts.

4. ✅ **No backpressure on the DSP worker** — Added `MAX_WORKER_PENDING = 4` counter per VFO in `worker/rx-stream.ts`. Chunks are dropped (and counted in `perf.droppedChunks`) when a worker's queue is full.

5. ✅ **Missing input validation** — Created `src/client/worker/validation.ts` (`validateFrequency`, `validateSampleRate`, `clampGain`, `validateAndClampGains`). All four functions called from `Backend.setSampleRate`, `setFrequency`, `setGain`, `setGains`.

---

## Medium Priority

6. ✅ **Single-threaded DSP** — Added `navigator.hardwareConcurrency` awareness: `rx-stream.ts` logs the recommended max VFO count at startup; `Backend.addVfo()` warns when the count exceeds `hardwareConcurrency - 1`; `DspStats` now exposes `workerCount` and `hardwareConcurrency`.

7. ✅ **WebRTC reconnection without backoff** — Added `backoffDelay(attempt, base, cap)` pure function (exported, tested). `connectWithRetry` now passes an `attempt` counter and delays `unavailable-id` retries via `setTimeout`. `disconnected` event handler performs up to `MAX_RECONNECT = 5` reconnects with exponential backoff + jitter; `reconnectAttempt` resets on `open`.

8. ✅ **Inconsistent device drivers** — Unified error tags to `[BrowSDR:X]` in all four drivers. Added missing `default: console.warn(...)` to `setGain` in Airspy and AirspyHF. Fixed `MockHackRF` gain name `'Amp'` → `'Amp (14dB)'` to match the real `HackRFDevice`.

9. ✅ **Fragile Vite config** — Replaced the content-sniffing heuristic (scanning for `from './'`) with an explicit `EXTRA_WORKERS` array. Workers to bundle are now declared at the top of the file; the two `build()` calls are unified into a single loop. The `.ts → .js` rename step is preserved as a safety net with a comment explaining why it exists.

10. ✅ **PWA cache strategy** — Split the single `/api/*` NetworkFirst rule into two: `/api/geo` uses `StaleWhileRevalidate` (country code rarely changes; works offline) and `/api/turn` uses `NetworkOnly` (TURN credentials expire server-side; a cached response would silently break WebRTC).

---

## Low Priority / Quality Improvements

11. ✅ **TypeScript strictness** — Created `src/client/worker/dsp-worker-types.ts` with `DspWorkerInMessage` / `DspWorkerOutMessage` discriminated unions and `DspWorkerVfoState` interface. Applied in `dsp-worker.ts` (typed `_wasm`, `ddc`, `vfoState`; removed `(self as any).postMessage`; typed `configureDDC`/`processVfoAudio` params; `err: unknown` in catch blocks) and in `rx-stream.ts` (`MessageEvent<DspWorkerOutMessage>`). Fixed `(window as any).webkitAudioContext` in `ui-helpers.ts` with a `declare global` interface extension. Duplicate `IF_RATES`/`AUDIO_RATE` constants removed from `dsp-worker.ts` (now imported from `worker/types.ts`). Typecheck passes with zero errors.

12. ✅ **Undocumented Backend class** — Added TSDoc to `worker/backend.ts`: class-level doc explaining the Comlink lifecycle and the `Comlink.proxy()` requirement for callbacks; method-level docs for `init`, `open`, `startRxStream`, `getDspStats` (squelch-latch side effect), `addVfo`, `removeVfo`, `setFrequency` (propagates to workers), and `startRx`.

13. ✅ **Bookmark sync** — Added manual cloud sync via Cloudflare KV. Token-based (UUID generated once, stored in `localStorage`; share it between devices to sync). New edge routes: `GET /api/bookmarks?token=` and `PUT /api/bookmarks?token=` (512 KB limit, 1-year TTL). Client methods: `initSyncToken` (called from `loadBookmarks`), `pushToCloud`, `pullFromCloud` (merge or replace). KV namespace binding added to `wrangler.jsonc`; create with `npx wrangler kv namespace create BOOKMARKS` and fill in the returned IDs.

14. ✅ **POCSAG deduplication** — In `rx-stream.ts`, before creating or using a `POCSAGDecoder` for VFO `v`, a frequency-conflict check scans all lower-index VFOs (`i < v`) for one with `pocsag && mode === 'nfm'` at the same frequency (±1 kHz). If found, VFO `v` yields — it skips processing and releases any stale decoder. The lower-index VFO's decoder reports the message once.

15. ✅ **Self-hosting** — Added `server.mjs`: a zero-dependency Node.js 18+ server that replicates all four Cloudflare Worker routes (`/api/geo`, `/api/turn`, `/api/bookmarks`, `/hf-proxy/*`), serves `dist/` as static files with the required COOP/COEP headers, and stores bookmarks in a local `bookmarks-store.json`. Configured via env vars (`PORT`, `TURN_URL`, `TURN_USER`, `TURN_PASS`, `GEO_COUNTRY`). Added `npm run serve` script. For production: place behind a TLS reverse proxy (nginx/Caddy) since WebUSB requires HTTPS.

16. ✅ **IQ recording/playback** — Raw `.s16` (int16 IQ) recording via File System Access API. IQ data is intercepted in the USB callback inside `rx-stream.ts`, converted from Int8 to Int16, and streamed to disk in batches. Playback uses `FileSdrDevice` (`file-sdr.ts`), an `SdrDevice` implementation that reads `.s16` files and feeds the existing DSP pipeline at the original sample rate with `setTimeout` pacing. New toolbar buttons (Record/Stop/Play from file) and bottom status panel. See `app/recording.ts` for the Vue integration. Compatible with SDR++, GQRX, and other SDR apps.

---

## New Feature Proposals

### Protocol Decoders

| Feature | Description | Notes |
|---|---|---|
| **RDS** | Show station name, artist and song title on FM broadcasts | Pure JS/TS, no WASM needed |
| **ADS-B** | Aircraft tracking at 1090 MHz with a live map | `pocsag.ts` already sets the pattern |
| **APRS** | Amateur radio position reporting on a map | Similar architecture to ADS-B |
| **NOAA APT** | Decode weather satellite images | Feasible via WASM |
| **FT8 / WSPR** | Popular amateur radio digital modes | Existing JS libraries available |
| **DTMF** | Telephone tone detection | Trivial with existing DSP primitives |

### Recording & Playback

| Feature | Description |
|---|---|
| **IQ recording/playback** | ✅ Implemented — raw `.s16` format via File System Access API (see point 16) |
| **Audio recording** | Save demodulated audio as WAV/MP3 |
| **Waterfall export** | Export waterfall screenshot as PNG |

### Spectrum Analysis

| Feature | Description |
|---|---|
| **Max/Min hold** | Overlay maximum and minimum FFT traces to catch transient peaks |
| **RSSI over time** | Plot signal level of a given frequency as a time series |
| **Frequency scanner** | Scan a list of frequencies and stop on squelch break |

### UI / Information

| Feature | Description |
|---|---|
| **Band plan overlay** | Colour-coded ITU/national frequency allocation overlay on the waterfall |
| **Frequency database** | Known-station database (shortwave, airband…) for signal identification |

### Priority Recommendation

1. **ADS-B** — highly visual, shareable result (live aircraft map from the browser).
2. **Audio recording** — Save demodulated audio as WAV/MP3.
