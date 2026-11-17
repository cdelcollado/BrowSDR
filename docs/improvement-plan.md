# Improvement plan: security and functionality

Status: proposed, 2026-11-17. This plan records a repository review and an ordered set of changes. It does not set release dates. Items marked **Decision** need a product choice before implementation.

## Scope and baseline

The review covered the Vue client, the Rust/WASM DSP crate, the Web Workers, the WebRTC remote-access layer, the Cloudflare Worker in `src/server/`, the build and CI configuration, and the tracked generated artifacts. Findings come from reading the code; no exploit was run against a deployment.

Baseline at review time:

| Check                                                  | Result                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `npm run typecheck`                                    | Passes                                                             |
| `npm run lint`                                         | Passes                                                             |
| `npx prettier . --check` and `npm run check:structure` | Pass                                                               |
| `cargo test` in `wasm/dsp`                             | 32 passed                                                          |
| `npx vitest run` after `npm run build`                 | 2090 passed, 5 failed (see F1, F2)                                 |
| `npm audit --omit=dev`                                 | 5 high-severity advisories in production dependencies (see S3)     |
| `npm outdated`                                         | Several development dependencies one or more major versions behind |

## Security findings

Ordered by severity.

### S1. Remote access has no host authorization (high)

Files: `src/client/remote/webrtc.ts`, `src/client/app/workspace/remote.ts`.

- The host opens a PeerJS peer with ID `browsdr-` plus a 5-character random base36 code. Anyone who has the code can connect. No password, approval step or consent prompt exists in the remote code.
- A connected client can change `radio.centerFreq`, `radio.sampleRate` and gains (`handleRequestChange`), and can add VFOs without limit (`handleAddRemoteVfo`). No cap on clients or VFOs was found.

### S2. Remote command validation is incomplete (medium)

File: `src/client/remote/validation.ts`.

- `numbers()` checks only that values are finite. `validIndex` has no upper bound. `centerFreq` accepts any finite number. Frequency, volume and bandwidth in `vfoUpdate` have no range checks.
- The backend may clamp these values, but the validation layer should reject them before they reach it.

### S3. Production dependencies have high-severity advisories (high)

`npm audit --omit=dev` reports `vue` (3.2.13 to 3.5.41), `@vue/server-renderer`, `nanoid`, `postcss` and `source-map-js`. For `vue` the fix is within the current semver range (3.5.45).

### S4. `/hf-proxy` is an open proxy (medium)

File: `src/server/index.ts`.

- Forwards any HTTP method to `huggingface.co`, with no rate limit.
- Copies all upstream response headers and sets `Access-Control-Allow-Origin: *`, so any website can use the Worker as a proxy.
- The upstream host is fixed, so this is not a general SSRF.

### S5. `/api/turn` has no rate limit (medium)

File: `src/server/index.ts`.

- Each request creates new TURN credentials through the Cloudflare API. Anyone can call it in a loop.
- The ExpressTURN static credentials are sent to every browser. This is unavoidable for browser-side WebRTC, but the credentials should be rotatable and scoped to TURN use.

### S6. No security headers (medium)

The Worker adds only COOP and COEP. There is no Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` or `Permissions-Policy`.

Note: Vue compiles templates at runtime (`vue.esm-bundler.js`). A strict CSP may need `'unsafe-eval'` or precompiled templates. Decide this before enforcing.

### S7. Third-party code loaded without integrity checks (medium)

File: `src/client/transcription/whisper-worker.ts:50`.

`import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1')` runs code from a CDN inside the worker. The version is pinned, but there is no SRI or hash verification. PeerJS and the WASM modules are already served from the project itself.

### S8. WebRTC signalling uses the PeerJS default broker (medium, to confirm)

`webrtc.ts` creates `new Peer(...)` without an explicit `host`. From the code, this appears to use PeerJS's default public broker, which would expose peer IDs and connection metadata to a third party. Not verified at runtime.

### S9. `innerHTML` with dynamic data (low)

Six call sites in `src/client/app/decoders/` (ADS-B, AIS, APRS, radiosonde). All current inputs are static literals or fixed SVG tables. APRS symbols already use `textContent`. A lint rule is needed so that future changes do not put radio-derived data into `innerHTML`.

### S10. Secrets hygiene (ok)

No secrets were found in tracked files. `.dev.vars*` and `.env*` are git-ignored.

## Functional and quality findings

### F1. ADS-B tests depend on the system locale (medium)

`src/client/app/decoders/adsb/map/tooltip.ts:17` formats altitude with `toLocaleString()` and no locale. Under `LANG=ca_ES.UTF-8` the output is `12.000 ft`; the tests expect `12,000 ft`. Four tests fail for this reason (`test/ui/adsb-details.spec.ts` x2, `test/ui/adsb-icons.spec.ts`, `test/ui/adsb.spec.ts`). CI on an en-US runner does not show it.

The underlying issue is that the UI output depends on the browser locale while the tests assume one locale.

### F2. RTK lookback test times out (medium)

`test/rtk/discovery/lookback.spec.js` ("recovers rtk1 sent before its hint…") fails with a 5 s timeout. The cause has not been investigated: it may be machine load or a real timing problem.

### F3. Worker tests need a build (low)

`npm test` fails with "assets directory does not exist" unless `npm run build` has run first. CI already builds first, so this is a developer trap rather than a CI failure.

### F4. Wrangler configuration warning (low)

`wrangler.jsonc` contains a `previews` field that the installed Wrangler does not recognize.

### F5. Generated WASM artifacts are tracked (medium)

`wasm/dsp/pkg`, `wasm/dsp/node`, `wasm/rtl433/pkg` and `wasm/nrsc5/pkg` are committed. At review time `wasm/dsp/pkg` already showed uncommitted modifications, so the committed artifacts can drift from the Rust source.

### F6. CI configuration drift (low)

- `.github/workflows/test.yml` triggers only on `master`, but the default branch is `main`.
- It runs `cargo make test`, which overlaps with `npm run test:dsp` in `quality.yml`.
- Actions are pinned to tags (`@v4`), not commit SHAs.

### F7. Dependencies are behind (low)

Development tooling is outdated: `vitest` 3.2.7 (latest 5.1.0), `vite` 6.4.1 (latest 8.3.8), `vite-plugin-pwa` 1.2.0 (latest 2.0.0), `jsdom`, `@types/node`. Minor and patch updates are routine; major updates need their own branch.

### F8. Large decoder modules and silent error handling (low)

- Largest modules: `rds.ts` (1044 lines), `pocsag.ts` (940), `frame.ts` (936), `dsd-decoder.ts` (827). `docs/code-quality.md` sets a 600-line limit on non-blank lines; this has not been checked per file.
- About 38 `catch` blocks swallow errors. Most have a comment; the rest should log at debug level.
- Only six `as any`, `@ts-ignore` or `eslint-disable` markers exist. This is good and should be kept that way.

## Not covered

- Rust DSP handling of malformed USB data and possible panics; device driver bounds checks. These need a dedicated review and fuzzing.
- The deployed Cloudflare configuration (dashboard settings, secrets, routes).
- Runtime verification of S1, S2, S4 and S8.
- Rust linting: `cargo clippy` is not installed in the review environment.

## Plan

### Phase 0: quick, low-risk (1–2 days)

1. Update production dependencies with non-breaking updates (`npm update vue @vue/server-renderer nanoid postcss source-map-js`). Run `npm run check` and the test suite. Addresses S3.
2. Restrict `/hf-proxy`: `GET` and `HEAD` only, allowed path prefix for Whisper models, allow-listed response headers, CORS limited to the app origin. Addresses S4.
3. Add rate limiting and caching of TURN credentials (about one hour, Cache API) to `/api/turn`. Addresses S5.
4. Add security headers. Start with `Content-Security-Policy-Report-Only` to confirm PeerJS, OpenStreetMap tiles and Whisper still work, then enforce. Add `Permissions-Policy: usb=(self)`. Addresses S6.
5. Make the ADS-B formatting locale-explicit and update the tests (F1).
6. Fix the `previews` warning in `wrangler.jsonc` (F4) and the branch filter in `test.yml` (F6).

**Exit criteria:** `npm run check` passes; `npm test -- --run` passes except for F2; `npm audit --omit=dev` reports no high advisories; headers verified in a deployed preview.

**Status (2026-11-17): implemented, not yet deployed.**

- Item 1 (S3): `vue` raised to 3.5.45 (`npm update` alone did not move it past the lockfile pin, so `package.json` now says `^3.5.45`). `npm audit --omit=dev` reports 0 vulnerabilities.
- Item 2 (S4): `src/server/hf-proxy.ts`. Only `GET`/`HEAD`; only `onnx-community/whisper-*` and `Xenova/whisper-*` `resolve` paths; decoded dot segments and encoded separators refused; query string restricted; only file-content headers returned; no `Access-Control-Allow-Origin` (the proxy is same-origin).
- Item 3 (S5): `src/server/turn.ts`. Cloudflare-generated credentials are cached in the Workers Cache API for one hour; `/api/turn` returns `Cache-Control: no-store`. **Not done in code:** a per-IP rate limit. Per-isolate counters do not hold across Cloudflare's edge, so this should be a Cloudflare WAF rate-limiting rule on `/api/turn`, configured in the dashboard.
- Item 4 (S6): `src/server/security.ts`. Adds `Content-Security-Policy-Report-Only`, `Permissions-Policy` (`usb=(self)`, camera, microphone, geolocation, payment, serial and HID disabled), `X-Content-Type-Options`, `Referrer-Policy`. Still report-only; enforce after the preview shows no violations. `'unsafe-eval'` stays until templates are precompiled.
- Item 5 (F1): the four locale-dependent ADS-B tests now derive expected text with `toLocaleString()` through `test/ui/helpers/altitude.ts`. The UI keeps following the browser locale, which is the recommended answer to open decision 4; this is not yet confirmed by the owner.
- Item 6 (F4, F6): removed the unknown top-level `previews` field from `wrangler.jsonc`, and `test.yml` now runs on `main` as well as `master`.

Tests added in `test/server/hardening.spec.js` (17 cases). Verification: `npm run check` passes; `npm run build` passes; `npx vitest run` gives 2111 passed and 1 failed (the RTK lookback timeout, F2, Phase 2).

**Still open for Phase 0 exit:** the deployed preview check of the CSP report-only violations, and the dashboard rate-limit rule.

### Phase 1: remote access security (1–2 weeks)

7. **Decision: host authorization model.** Options:
   - (a) manual approval by the host for each new client;
   - (b) a session passcode generated by the host;
   - (c) both, plus a read-only role for listeners.

   Recommendation: (a) at minimum, plus a read-only role. Also lengthen the share code to at least 10 characters.

8. Enforce limits on clients, VFOs per client and command rate. Addresses S1.
9. Add explicit range checks for every numeric field in `validation.ts`, and property-based tests for malformed messages. Addresses S2.
10. Confirm the PeerJS broker in use. Decide whether to run a project-controlled broker, possibly served by the Worker. Addresses S8.
11. Vendor `@huggingface/transformers` under `public/` (or serve it through the project) instead of importing from jsDelivr. Addresses S7.

**Exit criteria:** a test shows that an unapproved client cannot send `requestChange` or `addRemoteVfo`; limits are enforced; the remote UI tests still pass.

### Phase 2: quality and functionality

12. Investigate the RTK lookback timeout by running it in isolation and under load. Fix the cause or the test (F2).
13. Add a lint rule (`no-restricted-syntax`) that rejects `innerHTML` with non-literal values (S9).
14. Review the about 38 silent `catch` blocks and log errors at debug level where appropriate (F8).
15. Decide on the WASM artifact policy (F5): either build the artifacts in CI and verify they match the source, or stop tracking them.
16. Make Vitest runs independent of a prior build, or document the requirement clearly (F3).
17. Move major development dependencies (Vitest, Vite, vite-plugin-pwa, jsdom) to a separate branch with their own verification (F7).

### Phase 3: maintainability

18. Split the largest decoder modules into cohesive files, following the existing `worker/decoders/adsb/` and `dsd/` pattern (F8).
19. Pin GitHub Actions to commit SHAs. Add `npm audit --omit=dev` to CI as a gate.
20. Schedule a dedicated review of the Rust DSP and device drivers, with fuzzing of USB input.

## Verification for each change

- `npm run check` (lint, format, structure, typecheck, DSP tests).
- `npm run build` followed by `npm test -- --run`.
- For security changes, a test that demonstrates the blocked behaviour, not only the happy path.
- For header and proxy changes, a manual check in a Cloudflare preview deployment.

## Open decisions

1. Remote authorization model (Phase 1, item 7).
2. Whether to run a project-controlled PeerJS broker (Phase 1, item 10).
3. Whether to keep committed WASM artifacts (Phase 2, item 15).
4. Whether UI number formatting should follow the user's locale (F1). The recommended answer is yes, with tests that set the locale explicitly.
