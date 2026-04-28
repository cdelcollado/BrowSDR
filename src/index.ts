/**
 * BrowSDR - Cloudflare Worker
 *
 * Serves the static BrowSDR frontend from the public/ directory.
 * All static assets (HTML, JS, CSS, WASM) are served via the ASSETS binding.
 *
 * - Run `npm run dev` to start a development server on http://localhost:8787/
 * - Run `npm run deploy` to publish to Cloudflare
 */

interface KVNamespace {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
	EXPRESS_TURN_URL: string;
	EXPRESS_TURN_USER: string;
	EXPRESS_TURN_PASS: string;
	TURN_KEY_ID: string;
	TURN_KEY_API_TOKEN: string;
	ASSETS: {
		fetch(request: Request): Promise<Response>;
	};
	BOOKMARKS?: KVNamespace;
}

interface IceServerEntry {
	urls: string[];
	username?: string;
	credential?: string;
}

interface TurnApiResponse {
	iceServers?: IceServerEntry[];
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Cross-origin isolation headers (required for SharedArrayBuffer)
		const coopHeaders = {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		};

		// Return the caller's country code (from Cloudflare headers)
		if (url.pathname === '/api/geo') {
			return new Response(
				JSON.stringify({ country: request.headers.get('CF-IPCountry') || 'XX' }),
				{ headers: { 'Content-Type': 'application/json', ...coopHeaders } }
			);
		}

		// Return TURN/STUN ICE servers for WebRTC connectivity.
		// Uses ExpressTURN (free) as primary, Cloudflare TURN as fallback.
		if (url.pathname === '/api/turn') {
			const iceServers: IceServerEntry[] = [];

			// Primary: ExpressTURN (free, static credentials)
			if (env.EXPRESS_TURN_URL && env.EXPRESS_TURN_USER && env.EXPRESS_TURN_PASS) {
				iceServers.push({
					urls: [`turn:${env.EXPRESS_TURN_URL}`, `stun:${env.EXPRESS_TURN_URL}`],
					username: env.EXPRESS_TURN_USER,
					credential: env.EXPRESS_TURN_PASS,
				});
			}

			// Fallback: Cloudflare TURN (paid beyond 1TB free tier)
			if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
				try {
					const turnResp = await fetch(
						`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
						{
							method: 'POST',
							headers: {
								'Authorization': `Bearer ${env.TURN_KEY_API_TOKEN}`,
								'Content-Type': 'application/json',
							},
							body: JSON.stringify({ ttl: 14400 }), // 4 hours
						}
					);
					const data: TurnApiResponse = await turnResp.json();
					if (data.iceServers) iceServers.push(...data.iceServers);
				} catch (_) {}
			}

			return new Response(
				JSON.stringify({ iceServers }),
				{ headers: { 'Content-Type': 'application/json', ...coopHeaders } }
			);
		}

		// Bookmark cloud sync — GET fetches, PUT stores (token acts as a shared secret)
		if (url.pathname === '/api/bookmarks' && env.BOOKMARKS) {
			const token = url.searchParams.get('token') ?? '';
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
				return new Response('Invalid token', { status: 400, headers: coopHeaders });
			}
			const key = `bookmarks:${token}`;

			if (request.method === 'GET') {
				const value = await env.BOOKMARKS.get(key);
				if (!value) return new Response('Not found', { status: 404, headers: coopHeaders });
				return new Response(value, { headers: { 'Content-Type': 'application/json', ...coopHeaders } });
			}

			if (request.method === 'PUT') {
				const body = await request.text();
				if (body.length > 512 * 1024) {
					return new Response('Payload too large', { status: 413, headers: coopHeaders });
				}
				try { JSON.parse(body); } catch {
					return new Response('Invalid JSON', { status: 400, headers: coopHeaders });
				}
				await env.BOOKMARKS.put(key, body, { expirationTtl: 365 * 24 * 60 * 60 });
				return new Response('OK', { status: 200, headers: coopHeaders });
			}

			return new Response('Method not allowed', { status: 405, headers: coopHeaders });
		}

		// Proxy HuggingFace model downloads to avoid CORS issues
		if (url.pathname.startsWith('/hf-proxy/')) {
			const hfPath = url.pathname.slice('/hf-proxy/'.length) + url.search;
			const hfUrl = `https://huggingface.co/${hfPath}`;

			const hfResponse = await fetch(hfUrl, {
				method: request.method,
				headers: {
					'User-Agent': 'BrowSDR-Worker',
				},
			});

			const response = new Response(hfResponse.body, {
				status: hfResponse.status,
				headers: hfResponse.headers,
			});
			response.headers.set('Access-Control-Allow-Origin', '*');
			response.headers.delete('Set-Cookie');
			return response;
		}

		// Serve static assets with cross-origin isolation headers
		const response = await env.ASSETS.fetch(request);
		const newResponse = new Response(response.body, response);
		newResponse.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
		newResponse.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
		return newResponse;
	},
};
