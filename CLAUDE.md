# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Dev server (http://localhost:5173)
npm run dev

# Build WASM module (required after any Rust changes)
cd hackrf-web && cargo make build && cd ..

# Type check
npm run typecheck

# Run tests (Vitest)
npm run test

# Run a single test file
npx vitest run test/index.spec.js

# Run Rust/WASM tests
cd hackrf-web && cargo make test

# Build for production
npm run build

# Deploy to Cloudflare Workers
npm run deploy
```

After changing bindings in `wrangler.jsonc`, run `npx wrangler types` to regenerate TypeScript types.

## Architecture

BrowSDR is a browser-based SDR (Software Defined Radio) app. It has two distinct runtime layers:

**Cloudflare Worker (`src/index.ts`)** — the edge deployment entry point. Serves static assets and exposes three API routes: `/api/geo` (country lookup), `/api/turn` (WebRTC ICE/TURN credentials), and `/hf-proxy/*` (HuggingFace model download proxy to avoid CORS).

**Browser client (`src/client/`)** — the actual SDR application:

- `app/` — Vue 3 (Options API) application. `app/main.ts` is the entry point. State lives in `app/state.ts`; per-VFO computed values in `app/computed.ts`.
- `worker/` — Web Worker that runs all DSP off the main thread. `worker/main.ts` exposes the `Backend` class via [Comlink](https://github.com/GoogleChromeLabs/comlink). The main thread communicates with it through a Comlink proxy. `worker/dsp-pipeline.ts` is the signal processing chain.
- `devices/` — WebUSB device drivers for HackRF, Airspy, AirspyHF, and RTL-SDR. Each implements the `SdrDevice` interface from `sdr-device.ts`.
- `dsp-worker.ts` / `whisper-worker.ts` — dedicated workers for DSP and Whisper AI transcription respectively.
- `webrtc.ts` + `app/remote.ts` — WebRTC remote sharing via PeerJS.

**Rust/WASM DSP module (`hackrf-web/`)** — FFT and signal processing written in Rust, compiled to WASM via `wasm-pack`. Build output goes to `hackrf-web/pkg/` (committed to repo so CI/deploy doesn't need the Rust toolchain). The `dsp/` subdirectory contains: `filter.rs`, `decimation.rs`, `resampler.rs`, `primitives.rs`, and `taps.rs`.

## Key Constraints

- **COOP/COEP headers are required** — `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` must be present on all responses. SharedArrayBuffer (used by Web Workers) won't work without them. The Cloudflare Worker in `src/index.ts` injects these on every response.
- **WebUSB requires a secure context** — HTTPS or `localhost` only. Chrome/Edge only.
- **WASM build artifacts are committed** — `hackrf-web/pkg/` is in the repo so deployment works without Rust installed. Only rebuild if you change Rust source.
- **Cloudflare Workers docs may be outdated in training data** — always fetch current docs before working on the Worker layer (see `AGENTS.md`).
