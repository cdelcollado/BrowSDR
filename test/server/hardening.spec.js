import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/server';

const origin = 'http://example.com';

async function call(path, init, bindings = {}) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`${origin}${path}`, init), { ASSETS: env.ASSETS, ...bindings }, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('security headers', () => {
	it.each(['/', '/api/geo', '/api/turn', '/hf-proxy/evil.example/x'])('sets the policy headers on %s', async (path) => {
		const response = await call(path);
		expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain("frame-ancestors 'none'");
		expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain("object-src 'none'");
		expect(response.headers.get('Permissions-Policy')).toContain('usb=(self)');
		expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
	});

	it('does not send a CORS header from the API or the proxy', async () => {
		expect((await call('/api/turn')).headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(
			(await call('/hf-proxy/onnx-community/whisper-tiny/resolve/main/config.json')).headers.get('Access-Control-Allow-Origin'),
		).toBeNull();
	});

	it('marks TURN and geo responses as not cacheable by browsers', async () => {
		expect((await call('/api/turn')).headers.get('Cache-Control')).toBe('no-store');
		expect((await call('/api/geo')).headers.get('Cache-Control')).toBe('no-store');
	});
});

describe('Hugging Face proxy', () => {
	it.each([
		['POST', '/hf-proxy/onnx-community/whisper-tiny/resolve/main/config.json'],
		['PUT', '/hf-proxy/onnx-community/whisper-tiny/resolve/main/config.json'],
	])('rejects %s requests with 405', async (method, path) => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const response = await call(path, { method });
		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('GET, HEAD');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it.each([
		'/hf-proxy/someone/else-model/resolve/main/config.json',
		'/hf-proxy/onnx-community/whisper-tiny/tree/main',
		'/hf-proxy/onnx-community/whisper-tiny/resolve/main/%2e%2e/%2e%2e/secret',
		'/hf-proxy/onnx-community/whisper-tiny/resolve/main/..%2f..%2fsecret',
		'/hf-proxy/onnx-community/whisper-tiny/resolve/main/%E0%A4%A',
		'/hf-proxy/onnx-community/whisper-tiny/resolve/main/config.json?token=abc%20def',
	])('refuses %s without contacting Hugging Face', async (path) => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const response = await call(path);
		expect(response.status).toBe(404);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('forwards allowed Whisper files and only file-content headers', async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response('{"ok":true}', {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						ETag: '"abc"',
						'Set-Cookie': 'session=secret',
						'Access-Control-Allow-Origin': '*',
						'X-Internal-Debug': 'yes',
					},
				}),
		);
		vi.stubGlobal('fetch', fetchSpy);
		const response = await call('/hf-proxy/onnx-community/whisper-tiny/resolve/main/config.json');
		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(fetchSpy.mock.calls[0][0]).toBe('https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json');
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expect(response.headers.get('ETag')).toBe('"abc"');
		expect(response.headers.get('Set-Cookie')).toBeNull();
		expect(response.headers.get('X-Internal-Debug')).toBeNull();
		expect(await response.text()).toBe('{"ok":true}');
	});
});

describe('TURN credentials', () => {
	const turnEnv = {
		ASSETS: env.ASSETS,
		TURN_KEY_ID: 'key-id',
		TURN_KEY_API_TOKEN: 'token',
		EXPRESS_TURN_URL: 'turn.example:3478',
		EXPRESS_TURN_USER: 'u',
		EXPRESS_TURN_PASS: 'p',
	};

	it('calls Cloudflare once and serves cached credentials afterwards', async () => {
		const upstream = vi.fn(
			async () =>
				new Response(JSON.stringify({ iceServers: [{ urls: ['turn:cf.example:3478'], username: 'cu', credential: 'cp' }] }), {
					headers: { 'Content-Type': 'application/json' },
				}),
		);
		vi.stubGlobal('fetch', upstream);

		const first = await (await call('/api/turn', undefined, turnEnv)).json();
		const second = await (await call('/api/turn', undefined, turnEnv)).json();

		expect(first.iceServers).toHaveLength(2);
		expect(first.iceServers[0].urls).toEqual(['turn:turn.example:3478', 'stun:turn.example:3478']);
		expect(second.iceServers.map((server) => server.username)).toEqual(['u', 'cu']);
		expect(upstream).toHaveBeenCalledTimes(1);
	});

	it('still returns the static ExpressTURN server when Cloudflare fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 })),
		);
		const body = await (await call('/api/turn', undefined, { ...turnEnv, TURN_KEY_ID: 'failing-key' })).json();
		expect(body.iceServers).toHaveLength(1);
	});
});
