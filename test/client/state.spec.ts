import { describe, it, expect } from 'vitest';
import { createAppData } from '../../src/client/app/state';

describe('createAppData', () => {
	it('initializes radio defaults', () => {
		const data = createAppData();
		expect(data.radio.centerFreq).toBe(100.0);
		expect(data.radio.sampleRate).toBe(20_000_000);
		expect(data.radio.fftSize).toBe(65536);
	});

	it('initializes display defaults', () => {
		const data = createAppData();
		expect(data.display.minDB).toBe(-70.0);
		expect(data.display.maxDB).toBe(0.0);
	});

	it('starts disconnected and not running', () => {
		const data = createAppData();
		expect(data.connected).toBe(false);
		expect(data.running).toBe(false);
	});

	it('starts in no remote mode', () => {
		const data = createAppData();
		expect(data.remoteMode).toBe('none');
	});

	it('creates one default VFO at 100 MHz in WFM mode', () => {
		const data = createAppData();
		expect(data.vfos).toHaveLength(1);
		expect(data.vfos[0].freq).toBe(100.0);
		expect(data.vfos[0].enabled).toBe(false);
		expect(data.vfos[0].mode).toBe('wfm');
		expect(data.vfos[0].bandwidth).toBe(150000);
	});

	it('sets activeVfoIndex to 0', () => {
		const data = createAppData();
		expect(data.activeVfoIndex).toBe(0);
	});

	it('initializes view with no zoom or offset', () => {
		const data = createAppData();
		expect(data.view.zoomScale).toBe(1.0);
		expect(data.view.zoomOffset).toBe(0.0);
		expect(data.view.locked).toBe(false);
	});

	it('initializes whisper as idle with empty log', () => {
		const data = createAppData();
		expect(data.whisper.status).toBe('idle');
		expect(data.whisper.active).toBe(false);
		expect(data.whisper.log).toEqual([]);
		expect(data.whisper.pendingChunks).toBe(0);
	});

	it('initializes pocsag with empty log', () => {
		const data = createAppData();
		expect(data.pocsag.log).toEqual([]);
	});

	it('initializes bookmarks as empty array', () => {
		const data = createAppData();
		expect(data.bookmarks).toEqual([]);
	});

	it('initializes vfoConflictDialog as hidden', () => {
		const data = createAppData();
		expect(data.vfoConflictDialog.show).toBe(false);
		expect(data.vfoConflictDialog.vfoIndex).toBe(-1);
	});

	it('returns independent instances on each call', () => {
		const a = createAppData();
		const b = createAppData();
		a.radio.centerFreq = 200.0;
		expect(b.radio.centerFreq).toBe(100.0);
	});

	it('vfo displayFreq matches freq formatted to 6 decimal places', () => {
		const data = createAppData();
		expect(data.vfos[0].displayFreq).toBe('100.000000');
	});
});
