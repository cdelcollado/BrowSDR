import { describe, it, expect } from 'vitest';
import {
	sinc,
	hzToRads,
	estimateTapCount,
	nuttall,
	gcd,
	lowPassTaps,
	bandPassTaps,
	FIRFilter,
	RationalResampler,
} from '../../src/client/worker/dsp-pipeline';

describe('sinc', () => {
	it('returns 1 at x=0', () => {
		expect(sinc(0)).toBe(1.0);
	});

	it('returns sin(x)/x for non-zero x', () => {
		expect(sinc(1)).toBeCloseTo(Math.sin(1) / 1);
	});

	it('returns ~0 at integer multiples of π', () => {
		expect(sinc(Math.PI)).toBeCloseTo(0, 10);
		expect(sinc(2 * Math.PI)).toBeCloseTo(0, 10);
	});
});

describe('hzToRads', () => {
	it('converts Nyquist (sr/2) to π', () => {
		expect(hzToRads(500, 1000)).toBeCloseTo(Math.PI);
	});

	it('converts full rate to 2π', () => {
		expect(hzToRads(1000, 1000)).toBeCloseTo(2 * Math.PI);
	});

	it('returns 0 for 0 Hz', () => {
		expect(hzToRads(0, 1000)).toBe(0);
	});
});

describe('estimateTapCount', () => {
	it('returns floor(3.8 * sr / transWidth)', () => {
		expect(estimateTapCount(10000, 1000000)).toBe(380);
		expect(estimateTapCount(1000, 48000)).toBe(182);
	});
});

describe('nuttall', () => {
	it('returns 0 at the edge (n=0, any N)', () => {
		expect(nuttall(0, 100)).toBeCloseTo(0, 10);
	});

	it('returns 1.0 at the centre (n=N/2)', () => {
		expect(nuttall(5, 10)).toBeCloseTo(1.0, 10);
		expect(nuttall(50, 100)).toBeCloseTo(1.0, 10);
	});
});

describe('gcd', () => {
	it('computes basic cases', () => {
		expect(gcd(12, 8)).toBe(4);
		expect(gcd(100, 25)).toBe(25);
		expect(gcd(7, 1)).toBe(1);
	});

	it('handles zero inputs gracefully', () => {
		expect(gcd(0, 0)).toBe(1);
		expect(gcd(0, 7)).toBe(7);
		expect(gcd(7, 0)).toBe(7);
	});

	it('works for audio/SDR sample-rate pairs', () => {
		expect(gcd(48000, 24000)).toBe(24000);
		expect(gcd(48000, 250000)).toBe(2000);
	});
});

describe('FIRFilter', () => {
	it('acts as identity with taps=[1]', () => {
		const f = new FIRFilter(new Float32Array([1.0]));
		expect(f.processOne(5)).toBe(5);
		expect(f.processOne(3)).toBe(3);
	});

	it('defaults to identity when constructed with no args', () => {
		const f = new FIRFilter();
		expect(f.processOne(42)).toBe(42);
	});

	it('implements a 1-sample delay with taps=[0, 1]', () => {
		const f = new FIRFilter(new Float32Array([0, 1.0]));
		expect(f.processOne(1)).toBe(0); // no history yet
		expect(f.processOne(2)).toBe(1); // previous sample
		expect(f.processOne(3)).toBe(2);
	});

	it('setTaps resets history and index', () => {
		const f = new FIRFilter(new Float32Array([1.0]));
		f.processOne(99);
		f.setTaps(new Float32Array([1.0, 0.0]));
		expect(f.histIdx).toBe(0);
		expect(f.history.every(v => v === 0)).toBe(true);
	});

	it('reset() clears history', () => {
		const f = new FIRFilter(new Float32Array([1.0, 1.0]));
		f.processOne(10);
		f.reset();
		expect(f.histIdx).toBe(0);
		expect(f.history.every(v => v === 0)).toBe(true);
	});
});

describe('lowPassTaps', () => {
	it('returns a Float32Array of the expected length', () => {
		const taps = lowPassTaps(5000, 1000, 48000);
		const expectedCount = Math.floor(3.8 * 48000 / 1000);
		expect(taps).toBeInstanceOf(Float32Array);
		expect(taps.length).toBe(expectedCount);
	});

	it('forces odd count when oddTapCount=true', () => {
		const taps = lowPassTaps(5000, 1000, 48000, true);
		expect(taps.length % 2).toBe(1);
	});

	it('DC gain (sum of taps) is approximately 1', () => {
		const taps = lowPassTaps(12000, 1000, 48000);
		const sum = taps.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0, 1);
	});
});

describe('bandPassTaps', () => {
	it('returns a Float32Array', () => {
		const taps = bandPassTaps(1000, 5000, 500, 48000);
		expect(taps).toBeInstanceOf(Float32Array);
		expect(taps.length).toBeGreaterThan(0);
	});

	it('forces odd count when oddTapCount=true', () => {
		const taps = bandPassTaps(1000, 5000, 500, 48000, true);
		expect(taps.length % 2).toBe(1);
	});
});

describe('RationalResampler', () => {
	it('2:1 downsample produces exactly half the samples', () => {
		const r = new RationalResampler(48000, 24000);
		const input = new Float32Array(100).fill(0.5);
		const output = r.process(input);
		expect(output.length).toBe(50);
	});

	it('1:2 upsample produces exactly double the samples', () => {
		const r = new RationalResampler(24000, 48000);
		const input = new Float32Array(100).fill(0.5);
		const output = r.process(input);
		expect(output.length).toBe(200);
	});

	it('1:1 passthrough preserves sample count', () => {
		const r = new RationalResampler(48000, 48000);
		const input = new Float32Array(100);
		const output = r.process(input);
		expect(output.length).toBe(100);
	});
});
