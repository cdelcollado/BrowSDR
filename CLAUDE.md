# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Dev server (http://localhost:5173) — run alongside `npx wrangler dev` for API routes
npm run dev

# Local Cloudflare Worker dev server (API routes at http://localhost:8787)
npx wrangler dev

# Build WASM module (required after any Rust changes)
cd hackrf-web && cargo make build && cd ..

# Type check
npm run typecheck

# Run all tests (Vitest)
npm run test

# Run client-only tests (jsdom environment)
npm run test:client

# Run a single test file
npx vitest run test/index.spec.js

# Run Rust/WASM tests
cd hackrf-web && cargo make test

# Build for production
npm run build

# Deploy to Cloudflare Workers
npm run deploy

# Self-hosted alternative to Cloudflare (Node.js 18+, run after build)
npm run serve
```

After changing bindings in `wrangler.jsonc`, run `npx wrangler types` to regenerate TypeScript types.

## Architecture

BrowSDR is a browser-based SDR (Software Defined Radio) app. It has two distinct runtime layers:

**Cloudflare Worker (`src/index.ts`)** — the edge deployment entry point. Serves static assets and exposes four API routes: `/api/geo` (country lookup), `/api/turn` (WebRTC ICE/TURN credentials), `/api/bookmarks` (KV-backed cloud bookmark sync), and `/hf-proxy/*` (HuggingFace model download proxy to avoid CORS).

**Self-hosted alternative (`server.mjs`)** — a zero-dependency Node.js 18+ server that replicates all four API routes and serves the built `dist/`. Configure via env vars: `PORT`, `TURN_URL`, `TURN_USER`, `TURN_PASS`, `GEO_COUNTRY`. Bookmarks stored in `bookmarks-store.json`.

**Browser client (`src/client/`)** — the actual SDR application:

- `app/` — Vue 3 (Options API) application. `app/main.ts` is the entry point. State lives in `app/state.ts`; per-VFO computed values in `app/computed.ts`.
  - `app/recording.ts` — IQ recording/playback methods: save/stop IQ to `.s16` via File System Access API, and play back `.s16` files from disk.
- `worker/` — Web Worker that runs all DSP off the main thread. `worker/backend.ts` exposes the `Backend` class via [Comlink](https://github.com/GoogleChromeLabs/comlink). The main thread communicates with it through a Comlink proxy. `worker/dsp-pipeline.ts` is the signal processing chain.
  - `worker/dsp-worker-types.ts` — discriminated union types for the DSP worker message protocol (`DspWorkerInMessage`, `DspWorkerOutMessage`, `DspWorkerVfoState`).
  - `worker/validation.ts` — input validation helpers (`validateFrequency`, `validateSampleRate`, `clampGain`, `validateAndClampGains`).
  - `worker/types.ts` — shared interfaces and constants (`VfoParams`, `VfoState`, `PerfCounters`, `IF_RATES`, `AUDIO_RATE`, …).
- `devices/` — WebUSB device drivers for HackRF, Airspy, AirspyHF, and RTL-SDR. Each implements the `SdrDevice` interface from `sdr-device.ts`.
- `file-sdr.ts` — `FileSdrDevice`, an `SdrDevice` implementation that feeds IQ from `.s16` files into the DSP pipeline at the recorded sample rate.
- `dsp-worker.ts` / `whisper-worker.ts` — dedicated workers for DSP and Whisper AI transcription respectively.
- `logger.ts` — centralised logging helpers (`logError`, `logWarn`, `logInfo`) with `[BrowSDR:Tag]` prefix.
- `webrtc.ts` + `app/remote.ts` — WebRTC remote sharing via PeerJS.

**Rust/WASM DSP module (`hackrf-web/`)** — FFT and signal processing written in Rust, compiled to WASM via `wasm-pack`. Build output goes to `hackrf-web/pkg/` (committed to repo so CI/deploy doesn't need the Rust toolchain). The `dsp/` subdirectory contains: `filter.rs`, `decimation.rs`, `resampler.rs`, `primitives.rs`, and `taps.rs`.

## Key Constraints

- **COOP/COEP headers are required** — `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` must be present on all responses. SharedArrayBuffer (used by Web Workers) won't work without them. Both `src/index.ts` and `server.mjs` inject these on every response.
- **WebUSB requires a secure context** — HTTPS or `localhost` only. Chrome/Edge only.
- **WASM build artifacts are committed** — `hackrf-web/pkg/` is in the repo so deployment works without Rust installed. Only rebuild if you change Rust source.
- **Cloudflare Workers docs may be outdated in training data** — always fetch current docs before working on the Worker layer (see `AGENTS.md`).
- **KV namespace for bookmark sync** — the `BOOKMARKS` KV binding in `wrangler.jsonc` has empty IDs by default. Create with `npx wrangler kv namespace create BOOKMARKS` and fill in the returned IDs before deploying.
