import type { GainControl } from '../sdr-device';

export function validateFrequency(freqHz: number): void {
	if (!Number.isFinite(freqHz) || freqHz <= 0) {
		throw new RangeError(`Invalid frequency ${freqHz} Hz — must be a positive finite number`);
	}
}

export function validateSampleRate(rate: number, supported: readonly number[]): void {
	if (!Number.isFinite(rate) || rate <= 0) {
		throw new RangeError(`Invalid sample rate ${rate}`);
	}
	if (!supported.includes(rate)) {
		throw new RangeError(
			`Sample rate ${rate} not supported by device (supported: ${supported.join(', ')})`
		);
	}
}

export function clampGain(name: string, value: number, controls: readonly GainControl[]): number {
	if (!Number.isFinite(value)) {
		throw new RangeError(`Gain "${name}" value ${value} is not a finite number`);
	}
	const ctrl = controls.find(gc => gc.name === name);
	if (!ctrl) {
		throw new RangeError(`Unknown gain control "${name}"`);
	}
	return Math.min(ctrl.max, Math.max(ctrl.min, value));
}

export function validateAndClampGains(
	gains: Record<string, number>,
	controls: readonly GainControl[],
): Record<string, number> {
	// Validate everything before touching hardware so we never partially apply gains
	const result: Record<string, number> = {};
	for (const [name, value] of Object.entries(gains)) {
		result[name] = clampGain(name, value, controls);
	}
	return result;
}
