import { describe, it, expect, vi, afterEach } from 'vitest';
import { computedProperties } from '../../src/client/app/computed';

afterEach(() => {
	vi.unstubAllGlobals();
});

// Helper: call a computed property with a plain context object
function call<K extends keyof typeof computedProperties>(
	key: K,
	ctx: object,
): ReturnType<(typeof computedProperties)[K]> {
	return (computedProperties[key] as Function).call(ctx);
}

describe('isLocal', () => {
	it('returns true for localhost (jsdom default URL)', () => {
		expect(call('isLocal', {})).toBe(true);
	});

	it('returns true for 127.0.0.1', () => {
		vi.stubGlobal('location', { hostname: '127.0.0.1' });
		expect(call('isLocal', {})).toBe(true);
	});

	it('returns false for a remote hostname', () => {
		vi.stubGlobal('location', { hostname: 'example.com' });
		expect(call('isLocal', {})).toBe(false);
	});
});

describe('activeAudioVfos', () => {
	it('returns empty array when no VFOs are enabled', () => {
		const ctx = {
			vfos: [{ enabled: false }, { enabled: false }],
			vfoSquelchOpen: [false, false],
		};
		expect(call('activeAudioVfos', ctx)).toEqual([]);
	});

	it('includes an enabled VFO with squelch disabled', () => {
		const ctx = {
			vfos: [{ enabled: true, squelchEnabled: false }],
			vfoSquelchOpen: [false],
		};
		const result = call('activeAudioVfos', ctx);
		expect(result).toHaveLength(1);
		expect(result[0].index).toBe(0);
	});

	it('excludes an enabled VFO when squelch is closed', () => {
		const ctx = {
			vfos: [{ enabled: true, squelchEnabled: true }],
			vfoSquelchOpen: [false],
		};
		expect(call('activeAudioVfos', ctx)).toHaveLength(0);
	});

	it('includes an enabled VFO when squelch is enabled and open', () => {
		const ctx = {
			vfos: [{ enabled: true, squelchEnabled: true }],
			vfoSquelchOpen: [true],
		};
		const result = call('activeAudioVfos', ctx);
		expect(result).toHaveLength(1);
		expect(result[0].index).toBe(0);
	});

	it('handles mixed enabled/squelch states correctly', () => {
		const ctx = {
			vfos: [
				{ enabled: true, squelchEnabled: false },  // included
				{ enabled: false, squelchEnabled: false }, // excluded (disabled)
				{ enabled: true, squelchEnabled: true },   // excluded (squelch closed)
				{ enabled: true, squelchEnabled: true },   // included (squelch open)
			],
			vfoSquelchOpen: [false, false, false, true],
		};
		const result = call('activeAudioVfos', ctx);
		expect(result).toHaveLength(2);
		expect(result[0].index).toBe(0);
		expect(result[1].index).toBe(3);
	});
});

describe('minFreq / maxFreq', () => {
	const makeCtx = (
		centerFreq: number,
		sampleRate: number,
		zoomScale: number,
		zoomOffset: number,
	) => ({ radio: { centerFreq, sampleRate }, view: { zoomScale, zoomOffset } });

	it('full span, no zoom: covers center ± sr/2 MHz', () => {
		// center=100 MHz, sr=20 MHz → [90, 110]
		const ctx = makeCtx(100, 20_000_000, 1.0, 0.0);
		expect(call('minFreq', ctx)).toBeCloseTo(90.0);
		expect(call('maxFreq', ctx)).toBeCloseTo(110.0);
	});

	it('2× zoom from left edge shows left half', () => {
		// zoom=2, offset=0 → [90, 100]
		const ctx = makeCtx(100, 20_000_000, 2.0, 0.0);
		expect(call('minFreq', ctx)).toBeCloseTo(90.0);
		expect(call('maxFreq', ctx)).toBeCloseTo(100.0);
	});

	it('2× zoom from right half shows right half', () => {
		// zoom=2, offset=0.5 → [100, 110]
		const ctx = makeCtx(100, 20_000_000, 2.0, 0.5);
		expect(call('minFreq', ctx)).toBeCloseTo(100.0);
		expect(call('maxFreq', ctx)).toBeCloseTo(110.0);
	});

	it('maxFreq is always greater than minFreq', () => {
		const ctx = makeCtx(145, 2_000_000, 3.0, 0.2);
		expect(call('maxFreq', ctx)).toBeGreaterThan(call('minFreq', ctx));
	});
});

describe('sortedVfoActivity', () => {
	it('returns empty array when no squelch-enabled VFOs exist', () => {
		const ctx = {
			vfos: [{ squelchEnabled: false }, { squelchEnabled: false }],
			vfoActivityStats: [],
			activityNow: 0,
		};
		expect(call('sortedVfoActivity', ctx)).toEqual([]);
	});

	it('sorts VFOs by totalMs descending', () => {
		const ctx = {
			activityNow: 1000,
			vfos: [{ squelchEnabled: true }, { squelchEnabled: true }],
			vfoActivityStats: [
				{ count: 1, totalMs: 100, squelchOpenSince: null },
				{ count: 5, totalMs: 500, squelchOpenSince: null },
			],
		};
		const result = call('sortedVfoActivity', ctx);
		expect(result).toHaveLength(2);
		expect(result[0].index).toBe(1); // 500 ms first
		expect(result[1].index).toBe(0); // 100 ms second
	});

	it('adds live time for currently-open squelch', () => {
		const now = 2000;
		const openSince = 1000; // 1000 ms of live activity
		const ctx = {
			activityNow: now,
			vfos: [{ squelchEnabled: true }],
			vfoActivityStats: [{ count: 1, totalMs: 0, squelchOpenSince: openSince }],
		};
		const result = call('sortedVfoActivity', ctx);
		expect(result[0].totalMs).toBe(1000);
		expect(result[0].isLive).toBe(true);
	});
});

describe('bookmarkGroupsByCategory', () => {
	it('returns empty categories and groups for no bookmarks', () => {
		const ctx = { bookmarks: [], bookmarkSearch: '' };
		const result = call('bookmarkGroupsByCategory', ctx);
		expect(result.categories).toEqual([]);
		expect(result.flatGroups).toEqual([]);
	});

	it('buckets individual bookmarks by category, sorted by freq', () => {
		const ctx = {
			bookmarkSearch: '',
			bookmarks: [
				{ type: 'individual', name: 'Ch1', freq: 145.5, category: 'amateur' },
				{ type: 'individual', name: 'Ch2', freq: 145.0, category: 'amateur' },
				{ type: 'individual', name: 'Coast', freq: 156.8, category: 'marine' },
			],
		};
		const result = call('bookmarkGroupsByCategory', ctx);
		expect(result.categories).toHaveLength(2);
		const amateur = result.categories.find((c: any) => c.key === 'amateur');
		expect(amateur?.items).toHaveLength(2);
		expect(amateur?.items[0].bm.freq).toBe(145.0); // sorted ascending
		expect(amateur?.items[1].bm.freq).toBe(145.5);
	});

	it('places group bookmarks in flatGroups sorted by centerFreq', () => {
		const ctx = {
			bookmarkSearch: '',
			bookmarks: [
				{ type: 'group', name: 'Band B', centerFreq: 200.0 },
				{ type: 'group', name: 'Band A', centerFreq: 100.0 },
			],
		};
		const result = call('bookmarkGroupsByCategory', ctx);
		expect(result.flatGroups).toHaveLength(2);
		expect(result.flatGroups[0].bm.centerFreq).toBe(100.0);
		expect(result.flatGroups[1].bm.centerFreq).toBe(200.0);
	});

	it('filters by search text (name)', () => {
		const ctx = {
			bookmarkSearch: 'marine',
			bookmarks: [
				{ type: 'individual', name: 'Marine channel', freq: 156.8, category: 'marine' },
				{ type: 'individual', name: 'Amateur repeater', freq: 145.5, category: 'amateur' },
			],
		};
		const result = call('bookmarkGroupsByCategory', ctx);
		expect(result.categories).toHaveLength(1);
		expect(result.categories[0].key).toBe('marine');
	});

	it('uncategorised key sorts last', () => {
		const ctx = {
			bookmarkSearch: '',
			bookmarks: [
				{ type: 'individual', name: 'Unknown', freq: 100.0, category: '' },
				{ type: 'individual', name: 'Marine', freq: 156.8, category: 'marine' },
			],
		};
		const result = call('bookmarkGroupsByCategory', ctx);
		const keys = result.categories.map((c: any) => c.key);
		expect(keys[keys.length - 1]).toBe('');
	});
});
