import { describe, it, expect } from 'vitest';
import {
	validateFrequency,
	validateSampleRate,
	clampGain,
	validateAndClampGains,
} from '../../src/client/worker/validation';
import type { GainControl } from '../../src/client/sdr-device';

// ── Helpers ──────────────────────────────────────────────────────

const gain = (name: string, min: number, max: number): GainControl => ({
	name, min, max, step: 1, default: min, type: 'slider',
});

// ── validateFrequency ────────────────────────────────────────────

describe('validateFrequency', () => {
	it('accepts valid positive frequencies', () => {
		expect(() => validateFrequency(100e6)).not.toThrow();
		expect(() => validateFrequency(1)).not.toThrow();
		expect(() => validateFrequency(6e9)).not.toThrow();
	});

	it('throws for zero', () => {
		expect(() => validateFrequency(0)).toThrow(RangeError);
	});

	it('throws for negative frequencies', () => {
		expect(() => validateFrequency(-1e6)).toThrow(RangeError);
	});

	it('throws for NaN', () => {
		expect(() => validateFrequency(NaN)).toThrow(RangeError);
	});

	it('throws for Infinity', () => {
		expect(() => validateFrequency(Infinity)).toThrow(RangeError);
	});
});

// ── validateSampleRate ───────────────────────────────────────────

describe('validateSampleRate', () => {
	const supported = [2_000_000, 10_000_000, 20_000_000];

	it('accepts supported sample rates', () => {
		expect(() => validateSampleRate(2_000_000, supported)).not.toThrow();
		expect(() => validateSampleRate(20_000_000, supported)).not.toThrow();
	});

	it('throws for an unsupported rate', () => {
		expect(() => validateSampleRate(5_000_000, supported)).toThrow(RangeError);
	});

	it('throws for zero', () => {
		expect(() => validateSampleRate(0, supported)).toThrow(RangeError);
	});

	it('throws for negative rate', () => {
		expect(() => validateSampleRate(-1, supported)).toThrow(RangeError);
	});

	it('throws for NaN', () => {
		expect(() => validateSampleRate(NaN, supported)).toThrow(RangeError);
	});

	it('error message lists supported rates', () => {
		expect(() => validateSampleRate(5_000_000, supported))
			.toThrow(/2000000.*10000000.*20000000/);
	});
});

// ── clampGain ────────────────────────────────────────────────────

describe('clampGain', () => {
	const controls = [gain('IF', 0, 40), gain('RF', 0, 15)];

	it('returns in-range value unchanged', () => {
		expect(clampGain('IF', 25, controls)).toBe(25);
		expect(clampGain('RF', 0, controls)).toBe(0);
		expect(clampGain('RF', 15, controls)).toBe(15);
	});

	it('clamps value below min to min', () => {
		expect(clampGain('IF', -5, controls)).toBe(0);
		expect(clampGain('RF', -100, controls)).toBe(0);
	});

	it('clamps value above max to max', () => {
		expect(clampGain('IF', 99, controls)).toBe(40);
		expect(clampGain('RF', 20, controls)).toBe(15);
	});

	it('throws for unknown gain name', () => {
		expect(() => clampGain('LNA', 10, controls)).toThrow(RangeError);
		expect(() => clampGain('', 10, controls)).toThrow(RangeError);
	});

	it('throws for non-finite value', () => {
		expect(() => clampGain('IF', NaN, controls)).toThrow(RangeError);
		expect(() => clampGain('IF', Infinity, controls)).toThrow(RangeError);
	});
});

// ── validateAndClampGains ────────────────────────────────────────

describe('validateAndClampGains', () => {
	const controls = [gain('IF', 0, 40), gain('RF', 0, 15)];

	it('passes through valid in-range gains', () => {
		const result = validateAndClampGains({ IF: 20, RF: 10 }, controls);
		expect(result).toEqual({ IF: 20, RF: 10 });
	});

	it('clamps out-of-range values', () => {
		const result = validateAndClampGains({ IF: -5, RF: 99 }, controls);
		expect(result.IF).toBe(0);
		expect(result.RF).toBe(15);
	});

	it('throws for any unknown gain name', () => {
		expect(() => validateAndClampGains({ IF: 20, LNA: 10 }, controls)).toThrow(RangeError);
	});

	it('throws for any non-finite value before applying any gain', () => {
		expect(() => validateAndClampGains({ IF: NaN, RF: 10 }, controls)).toThrow(RangeError);
	});

	it('returns empty object for empty gains input', () => {
		expect(validateAndClampGains({}, controls)).toEqual({});
	});
});
