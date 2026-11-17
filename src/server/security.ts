/**
 * Security headers applied to every response the Worker returns.
 *
 * The CSP starts as report-only so that PeerJS, OpenStreetMap tiles, Whisper and the
 * database host can be checked in a preview before enforcement. Violations are reported
 * in the browser console; enforce by renaming the header to Content-Security-Policy.
 *
 * `'unsafe-eval'` remains because Vue compiles receiver templates at runtime
 * (`vue.esm-bundler.js`). Removing it requires precompiled templates (improvement plan S6).
 */
const contentSecurityPolicy = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' https://fonts.gstatic.com data:",
	"img-src 'self' data: blob: https://tile.openstreetmap.org",
	"media-src 'self' blob: data:",
	"worker-src 'self' blob:",
	"connect-src 'self' https://db.browser.jlynx.net https://0.peerjs.com wss://0.peerjs.com https://cdn.jsdelivr.net https://tile.openstreetmap.org",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
].join('; ');

const permissionsPolicy = ['usb=(self)', 'camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'serial=()', 'hid=()'].join(', ');

/** Returns a copy of the response with the security headers set; the body is passed through unchanged. */
export function withSecurityHeaders(response: Response): Response {
	const hardened = new Response(response.body, response);
	hardened.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	hardened.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	hardened.headers.set('Content-Security-Policy-Report-Only', contentSecurityPolicy);
	hardened.headers.set('Permissions-Policy', permissionsPolicy);
	hardened.headers.set('X-Content-Type-Options', 'nosniff');
	hardened.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	return hardened;
}
