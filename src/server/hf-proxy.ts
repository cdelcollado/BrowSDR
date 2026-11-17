/**
 * Same-origin proxy for Whisper model files, so COEP can be satisfied in production.
 *
 * Only the Whisper repositories used by the transcription worker are reachable, only
 * read requests are forwarded, and only file-content headers come back. The response is
 * same-origin, so no CORS header is set.
 */
const allowedPath = /^(?:onnx-community|Xenova)\/whisper-[A-Za-z0-9.-]+\/resolve\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const allowedQuery = /^\?[A-Za-z0-9_=&.-]*$/;
const forwardedResponseHeaders = [
	'accept-ranges',
	'cache-control',
	'content-encoding',
	'content-length',
	'content-range',
	'content-type',
	'etag',
	'last-modified',
	'x-linked-etag',
	'x-linked-size',
	'x-repo-commit',
];

export async function proxyHuggingFace(request: Request, url: URL): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD')
		return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });

	const hfPath = decodeURIComponentStrict(url.pathname.slice('/hf-proxy/'.length));
	if (hfPath === undefined || !allowedPath.test(hfPath) || hfPath.split('/').some((segment) => segment === '.' || segment === '..'))
		return new Response('Not found', { status: 404 });
	if (url.search && !allowedQuery.test(url.search)) return new Response('Not found', { status: 404 });

	const upstream = await fetch(`https://huggingface.co/${hfPath}${url.search}`, {
		method: request.method,
		headers: { 'User-Agent': 'BrowSDR-Worker' },
	});

	const headers = new Headers();
	for (const name of forwardedResponseHeaders) {
		const value = upstream.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
}

/** The allowlist is applied to the decoded path; encoded separators and dot segments are refused. */
function decodeURIComponentStrict(value: string): string | undefined {
	try {
		return decodeURIComponent(value);
	} catch {
		return undefined;
	}
}
