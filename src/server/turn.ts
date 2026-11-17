import type { Env, IceServerEntry } from './types';
import { isRecord } from '../client/platform/data';

/** Lifetime requested from Cloudflare TURN. */
const credentialTtlSeconds = 14400;
/**
 * The generated credentials are cached for an hour, so they still have at least three hours
 * left when a browser receives them. Cloudflare's API is called at most about once an hour per
 * cache, instead of once per request.
 */
const cacheTtlSeconds = 3600;
const cacheKey = new Request('https://browsdr.internal/cache/turn-ice-servers');

/** Returns ICE servers for WebRTC. Static ExpressTURN credentials are always included; Cloudflare credentials are cached. */
export async function iceServers(env: Env): Promise<IceServerEntry[]> {
	const servers: IceServerEntry[] = [];

	// Primary: ExpressTURN (free, static credentials)
	if (env.EXPRESS_TURN_URL && env.EXPRESS_TURN_USER && env.EXPRESS_TURN_PASS) {
		servers.push({
			urls: [`turn:${env.EXPRESS_TURN_URL}`, `stun:${env.EXPRESS_TURN_URL}`],
			username: env.EXPRESS_TURN_USER,
			credential: env.EXPRESS_TURN_PASS,
		});
	}

	// Fallback: Cloudflare TURN (paid beyond 1TB free tier)
	if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) servers.push(...(await cloudflareIceServers(env)));

	return servers;
}

async function cloudflareIceServers(env: Env): Promise<IceServerEntry[]> {
	const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
	const cached = cache ? await cache.match(cacheKey) : undefined;
	if (cached) {
		const value: unknown = await cached.json();
		if (isRecord(value) && Array.isArray(value.iceServers)) return value.iceServers.filter(isIceServer);
	}

	try {
		const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ ttl: credentialTtlSeconds }),
		});
		if (!response.ok) return [];
		const data: unknown = await response.json();
		if (!isRecord(data) || !Array.isArray(data.iceServers)) return [];
		const servers = data.iceServers.filter(isIceServer);
		if (cache && servers.length)
			await cache.put(
				cacheKey,
				new Response(JSON.stringify({ iceServers: servers }), {
					headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${cacheTtlSeconds}` },
				}),
			);
		return servers;
	} catch (_) {
		// Cloudflare TURN is optional; ExpressTURN and STUN still work without it.
		return [];
	}
}

export function isIceServer(value: unknown): value is IceServerEntry {
	return (
		isRecord(value) &&
		Array.isArray(value.urls) &&
		value.urls.every((url: unknown) => typeof url === 'string') &&
		(value.username === undefined || typeof value.username === 'string') &&
		(value.credential === undefined || typeof value.credential === 'string')
	);
}
