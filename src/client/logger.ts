// Thin tagged logger — works in the main thread and in Web Workers.
// All error paths should go through logError so console output is
// consistently prefixed and easy to grep/filter in DevTools.

function detail(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err !== undefined && err !== null) return String(err);
	return '';
}

export function logError(tag: string, msg: string, err?: unknown): void {
	const d = detail(err);
	console.error(`[BrowSDR:${tag}] ${msg}${d ? ': ' + d : ''}`, ...(err !== undefined ? [err] : []));
}

export function logWarn(tag: string, msg: string, err?: unknown): void {
	const d = detail(err);
	console.warn(`[BrowSDR:${tag}] ${msg}${d ? ': ' + d : ''}`);
}

export function logInfo(tag: string, msg: string): void {
	console.info(`[BrowSDR:${tag}] ${msg}`);
}
