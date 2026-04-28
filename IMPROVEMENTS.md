# BrowSDR — Possible Improvements

> Generated on 2026-04-26 from a static analysis of the codebase.

---

## Critical

1. **Near-zero test coverage** — Only 1 test file covering the Cloudflare Worker. No tests for Vue app logic, the DSP worker, device drivers, or the Rust/WASM pipeline. Vitest suites should be added for the main modules, along with integration tests for the DSP pipeline.

2. **Fragmented error handling** — Silent `catch (_) {}` blocks exist (e.g. TURN API call in `worker/main.ts`), error messages lack context, and there is no centralized logging. A WASM failure can hang the app with no indication.

---

## High Priority

3. **Monolithic state** (`app/state.ts`) — Over 60 fields in a single flat object. Should be split into slices (vfo, whisper, pocsag, remote) and `null as any` casts replaced with proper typed interfaces.

4. **No backpressure on the DSP worker** — There is no message queue limit between the main thread and the worker. If DSP can't keep up, buffers would grow unboundedly.

5. **Missing input validation** — Frequency and gain parameters are not validated before being sent to device drivers, allowing out-of-range values to reach hardware.

---

## Medium Priority

6. **Single-threaded DSP** — All multi-VFO processing runs in a single Web Worker. On modern machines this could be distributed across workers using `navigator.hardwareConcurrency`.

7. **WebRTC reconnection without backoff** — PeerJS retries are immediate, which could flood the signaling server during network outages. Exponential backoff should be added.

8. **Inconsistent device drivers** — Each driver (HackRF, RTL-SDR, Airspy, AirspyHF) handles USB errors differently. A common error protocol is needed, along with a more faithful `mock-hackrf.ts`.

9. **Fragile Vite config** — The post-build plugin that re-bundles workers and renames `.ts → .js` is brittle. The logic should be simplified or extracted to a separate script.

10. **PWA cache strategy** — The service worker uses network-first for `/api/*`, which would fail offline. The cache policy for TURN/geo endpoints should be revisited.

---

## Low Priority / Quality Improvements

11. **TypeScript strictness** — Despite `strict: true` in tsconfig, `as any` casts are scattered throughout. Adding `@typescript-eslint/no-explicit-any` and defining discriminated unions for inter-worker messages would improve safety.

12. **Undocumented Backend class** — Methods in `worker/main.ts` have no TSDoc. Understanding the Comlink proxy contract requires reading the full implementation.

13. **Bookmark sync** — Bookmarks are stored in `localStorage` without encryption or cross-device sync. Integration with Cloudflare KV (already available in the edge worker) could address this.

14. **POCSAG deduplication** — If two VFOs are tuned to the same frequency, the POCSAG decoder processes the signal twice. A decoder pooling mechanism is needed.

15. **Self-hosting** — The app depends on Cloudflare Workers for the TURN proxy. Documenting how to deploy on other platforms (e.g. a plain Node.js server) would reduce vendor lock-in.

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
| **IQ recording/playback** | Record raw IQ samples to file and replay them — the most expected core SDR feature |
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

1. **IQ recording/playback** — highest effort-to-value ratio; expected by most SDR users and enables offline decoder testing without hardware.
2. **ADS-B** — highly visual, shareable result (live aircraft map from the browser).
