import type { Env } from './types';
import { updateMaritimeDatabase } from './maritime-db/update';
import { updateDatabase } from './aircraft-db/update';
import { proxyHuggingFace } from './hf-proxy';
import { iceServers } from './turn';
import { withSecurityHeaders } from './security';
/**
 * BrowSDR - Cloudflare Worker
 *
 * Serves the static BrowSDR frontend from dist/ and refreshes aircraft and maritime metadata weekly.
 * All static assets (HTML, JS, CSS, WASM) are served via the ASSETS binding.
 *
 * - Run `npm run dev:worker` to start the Worker on http://localhost:8788/
 * - Run `npm run deploy` to publish to Cloudflare
 */

export default {
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		const results = await Promise.allSettled([updateDatabase(env.DATABASES), updateMaritimeDatabase(env.DATABASES)]);
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => String(result.reason)),
				'Database refresh failed',
			);
	},
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		return withSecurityHeaders(await route(request, env));
	},
};

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	// Return the caller's country code (from Cloudflare headers)
	if (url.pathname === '/api/geo') {
		return new Response(JSON.stringify({ country: request.headers.get('CF-IPCountry') || 'XX' }), {
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	}

	// Return TURN/STUN ICE servers for WebRTC connectivity (see turn.ts for caching).
	if (url.pathname === '/api/turn') {
		return new Response(JSON.stringify({ iceServers: await iceServers(env) }), {
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	}

	// Proxy Whisper model downloads to avoid CORS issues (see hf-proxy.ts for the allowlist).
	if (url.pathname.startsWith('/hf-proxy/')) return proxyHuggingFace(request, url);

	// Static assets: the ASSETS binding serves the built frontend.
	return env.ASSETS.fetch(request);
}
