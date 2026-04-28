import { describe, it, expect } from 'vitest';
import { backoffDelay } from '../../src/client/webrtc';

describe('backoffDelay', () => {
	it('attempt 0 returns a value in the base range', () => {
		const v = backoffDelay(0, 1000);
		expect(v).toBeGreaterThanOrEqual(750);   // 1000 * 0.75
		expect(v).toBeLessThanOrEqual(1250);     // 1000 * 1.25
	});

	it('attempt 1 returns a value in the 2×base range', () => {
		const v = backoffDelay(1, 1000);
		expect(v).toBeGreaterThanOrEqual(1500);  // 2000 * 0.75
		expect(v).toBeLessThanOrEqual(2500);     // 2000 * 1.25
	});

	it('attempt 2 returns a value in the 4×base range', () => {
		const v = backoffDelay(2, 1000);
		expect(v).toBeGreaterThanOrEqual(3000);
		expect(v).toBeLessThanOrEqual(5000);
	});

	it('caps at the provided cap value', () => {
		// attempt 10 would be 1000 * 2^10 = ~1M, well above cap=5000
		const v = backoffDelay(10, 1000, 5000);
		expect(v).toBeGreaterThanOrEqual(3750);  // 5000 * 0.75
		expect(v).toBeLessThanOrEqual(6250);     // 5000 * 1.25
	});

	it('default cap is 30000', () => {
		const v = backoffDelay(20); // 1000 * 2^20 >> 30000
		expect(v).toBeLessThanOrEqual(30000 * 1.25);
	});

	it('always returns a positive number', () => {
		for (let i = 0; i < 10; i++) {
			expect(backoffDelay(i)).toBeGreaterThan(0);
		}
	});

	it('different calls with same attempt produce different values (jitter)', () => {
		const results = new Set(Array.from({ length: 20 }, () => backoffDelay(0)));
		// With random jitter, highly unlikely all 20 values are identical
		expect(results.size).toBeGreaterThan(1);
	});
});
