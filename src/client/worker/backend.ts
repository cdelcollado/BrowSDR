/*
Copyright (c) 2026, jLynx <https://github.com/jLynx>

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
	Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
	Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the
	documentation and/or other materials provided with the distribution.
	Neither the name of Great Scott Gadgets nor the names of its contributors may be used to endorse or promote products derived from this software
	without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

import { ensureWasmInitialized, init } from './wasm-init';
import { MockHackRF } from './mock-hackrf';
import type { SdrDevice, SdrDeviceInfo, DeviceCapabilities } from '../sdr-device';
import { detectDevice } from '../sdr-device';
// Import device drivers so they self-register
import '../devices/hackrf';
import '../devices/rtlsdr';
import '../devices/airspy';
import '../devices/airspyhf';
import {
	setRemoteHostCallback,
	setRemoteHostFftCallback,
	setRemoteHostAudioCallback,
	setRemoteHostPocsagCallback,
	setRemoteHostSquelchCallback,
	_ensureRemoteClients,
	_getOrCreateClientState,
	addRemoteClient,
	removeRemoteClient,
	setRemoteVfoParams,
	addRemoteVfo,
	removeRemoteVfo,
	_queueRemoteAudio,
	_mixAndEmitRemoteAudio,
	_reinitRemoteClientWorkers,
	initRemoteClient,
	feedRemoteAudioChunk,
} from './remote-clients';
import { startRxStream, setIqRecordCallback } from './rx-stream';
import { validateFrequency, validateSampleRate, clampGain, validateAndClampGains } from './validation';
import type { VfoParams, VfoState, PerfCounters, RxStreamOpts, RemoteClientState, DeviceOpenOpts, FilePlaybackOpts } from './types';
import { FileSdrDevice } from './file-sdr';

/**
 * SDR backend running inside a Web Worker, exposed to the main thread via Comlink.
 *
 * Comlink contract: every method call crosses a MessageChannel boundary, so all
 * methods appear `async` to callers regardless of whether they return a Promise.
 * Callbacks passed to `startRxStream` / `startRx` must be wrapped with
 * `Comlink.proxy()` on the caller side so they can be invoked across the channel.
 *
 * Lifecycle: `init` → `open` → `startRxStream` → (use) → `stopRx` → `close`.
 */
export class Backend {
	// Hardware — generic SDR device
	device: SdrDevice | null = null;
	wasm: any;

	// VFO state
	vfoParams?: VfoParams[];
	vfoStates?: VfoState[];
	dspWorkers?: Worker[];
	ddcs?: any[];

	// Shared IQ buffers
	sharedIqPools?: (SharedArrayBuffer | ArrayBuffer)[];
	sharedIqViews?: Int8Array[];
	sabPoolIndex?: number;

	// DSP perf
	_perf?: PerfCounters;
	_perfInterval?: any;

	// Internal state
	_sampleRate?: number;
	_centerFreq?: number;
	_makeVfoState?: () => VfoState;
	_spawnWorker?: (index: number, params: VfoParams) => Worker;
	_handleWorkerAudio?: (v: number, msg: any) => void;
	_mixBuf?: Float32Array;
	_latchedSquelchOpen?: boolean[];

	// Remote client state
	_remoteHostCb?: any;
	_remoteHostFftCb?: any;
	_remoteHostAudioCb?: any;
	_remoteClients?: Map<string, RemoteClientState>;
	_remoteHostPocsagCb?: any;
	_remoteHostSquelchCb?: any;
	_remoteClientCb?: any;
	_remoteClientAudioCb?: any;
	_remoteClientWhisperCb?: any;

	constructor() {
	}

	/** Loads the WASM DSP module. Must be called before `open`. */
	async init(): Promise<void> {
		await ensureWasmInitialized();
		this.wasm = await init();
	}

	/**
	 * Opens a USB SDR device. Pass `"mock"` for a software-only HackRF simulator.
	 * Returns `false` (rather than throwing) when no matching device is found.
	 */
	async open(opts?: DeviceOpenOpts | "mock"): Promise<boolean> {
		if (opts === "mock") {
			this.device = new MockHackRF();
			await this.device.open(null as any);
			return true;
		}

		const devices = await (navigator as any).usb.getDevices();
		const usbDevice = !opts ? devices[0] : devices.find((d: any) => {
			if (opts.vendorId && d.vendorId !== opts.vendorId) return false;
			if (opts.productId && d.productId !== opts.productId) return false;
			if (opts.serialNumber && d.serialNumber !== opts.serialNumber) return false;
			return true;
		});
		if (!usbDevice) {
			return false;
		}

		// Detect which driver matches this USB device
		const driverEntry = detectDevice(usbDevice);
		if (!driverEntry) {
			console.error('No SDR driver found for device:', usbDevice.vendorId.toString(16), usbDevice.productId.toString(16));
			return false;
		}

		this.device = driverEntry.create();
		await this.device.open(usbDevice);
		return true;
	}

	async info(): Promise<SdrDeviceInfo> {
		if (!this.device) throw new Error('No device connected');
		return this.device.getInfo();
	}

	getDeviceCapabilities(): DeviceCapabilities | null {
		if (!this.device) return null;
		return {
			deviceType: this.device.deviceType,
			sampleRates: this.device.sampleRates,
			gainControls: this.device.gainControls,
			sampleFormat: this.device.sampleFormat,
		};
	}

	// Remote client methods (imported from remote-clients.ts)
	setRemoteHostCallback = setRemoteHostCallback.bind(this);
	setRemoteHostFftCallback = setRemoteHostFftCallback.bind(this);
	setRemoteHostAudioCallback = setRemoteHostAudioCallback.bind(this);
	setRemoteHostPocsagCallback = setRemoteHostPocsagCallback.bind(this);
	setRemoteHostSquelchCallback = setRemoteHostSquelchCallback.bind(this);
	_ensureRemoteClients = _ensureRemoteClients.bind(this);
	_getOrCreateClientState = _getOrCreateClientState.bind(this);
	addRemoteClient = addRemoteClient.bind(this);
	removeRemoteClient = removeRemoteClient.bind(this);
	setRemoteVfoParams = setRemoteVfoParams.bind(this);
	addRemoteVfo = addRemoteVfo.bind(this);
	removeRemoteVfo = removeRemoteVfo.bind(this);
	_queueRemoteAudio = _queueRemoteAudio.bind(this);
	_mixAndEmitRemoteAudio = _mixAndEmitRemoteAudio.bind(this);
	_reinitRemoteClientWorkers = _reinitRemoteClientWorkers.bind(this);
	initRemoteClient = initRemoteClient.bind(this);
	feedRemoteAudioChunk = feedRemoteAudioChunk.bind(this);

	/**
	 * Starts the full DSP pipeline: IQ capture → FFT → per-VFO demodulation.
	 * All callbacks must be wrapped with `Comlink.proxy()` on the caller side.
	 * `spectrumCallback(fftData: Float32Array)` fires at ~10 Hz.
	 * `audioCallback(vfoIndex, samples: Float32Array)` fires per decoded audio chunk.
	 */
	async startRxStream(opts: RxStreamOpts, spectrumCallback: any, audioCallback: any, whisperCallback: any = null, pocsagCallback: any = null): Promise<void> {
		return startRxStream(this, opts, spectrumCallback, audioCallback, whisperCallback, pocsagCallback);
	}

	/**
	 * Returns a snapshot of DSP performance counters and per-VFO squelch state.
	 * Side effect: latches the current squelch state so the next call reports
	 * any squelch-open event that occurred between calls (prevents missed blinks).
	 */
	getDspStats(): any {
		if (!this._perf) return null;

		const currentSquelch = this.vfoStates ? this.vfoStates.map(s => s.squelchOpen || false) : [];
		const latchedSquelch = this._latchedSquelchOpen || [];
		const combinedSquelch = currentSquelch.map((sq, i) => sq || latchedSquelch[i]);

		this._latchedSquelchOpen = [...currentSquelch];

		return {
			...this._perf.report,
			squelchOpen: combinedSquelch,
			squelchDb: this.vfoStates ? this.vfoStates.map(s => s.squelchDb ?? -120) : [],
			workerCount: this.dspWorkers?.length ?? 0,
			hardwareConcurrency: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0)
				? navigator.hardwareConcurrency : 0,
		};
	}

	setVfoParams(index: number, params: Partial<VfoParams>): void {
		if (!this.vfoParams || index < 0 || index >= this.vfoParams.length) return;
		Object.assign(this.vfoParams[index], params);

		if (this.dspWorkers && this.dspWorkers[index]) {
			this.dspWorkers[index].postMessage({
				type: 'configure',
				params: this.vfoParams[index],
				centerFreq: this._centerFreq
			});
		}

		if (params.pocsag === false && this.vfoStates && this.vfoStates[index]) {
			this.vfoStates[index].pocsagDecoder = null;
		}
	}

	/**
	 * Adds a VFO and its dedicated DSP worker. Returns the new VFO index.
	 * Emits a console warning when the total exceeds `hardwareConcurrency - 1`.
	 * Only valid after `startRxStream` has been called (requires `_spawnWorker`).
	 */
	addVfo(): number {
		if (!this.vfoParams) return -1;
		const hwConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0)
			? navigator.hardwareConcurrency : 4;
		const recommendedMax = Math.max(1, hwConcurrency - 1);
		if (this.vfoParams.length >= recommendedMax) {
			console.warn(
				`[BrowSDR:Backend] Adding VFO ${this.vfoParams.length + 1} exceeds recommended maximum ` +
				`(${recommendedMax}) for a ${hwConcurrency}-core system — DSP workers may compete for CPU`
			);
		}
		const centerFreq = this._centerFreq || 100.0;
		const bw = 150000;
		const params: VfoParams = { freq: centerFreq, mode: 'wfm', enabled: false, deEmphasis: '50us', squelchEnabled: false, squelchLevel: -100.0, lowPass: true, highPass: false, bandwidth: bw, volume: 50, pocsag: false };
		this.vfoParams.push(params);

		const index = this.vfoParams.length - 1;
		this.vfoStates!.push(this._makeVfoState!());
		this.dspWorkers!.push(this._spawnWorker!(index, params));

		return index;
	}

	/** Terminates the DSP worker for `index` and removes the VFO. No-op if only one VFO remains. */
	removeVfo(index: number): void {
		if (!this.vfoParams || index < 0 || index >= this.vfoParams.length) return;
		if (this.vfoParams.length <= 1) return;

		if (this.dspWorkers![index]) {
			this.dspWorkers![index].terminate();
		}

		this.vfoParams.splice(index, 1);
		this.dspWorkers!.splice(index, 1);
		this.vfoStates!.splice(index, 1);
	}

	// ── IQ Recording ────────────────────────────────────────────────
	_iqRecordCallback?: ((chunk: Int16Array) => void) | null;
	_iqRecordActive?: boolean;

	setIqRecording(active: boolean, callback?: any): void {
		this._iqRecordActive = active;
		this._iqRecordCallback = active ? callback : null;
		setIqRecordCallback(active, active ? callback : null);
	}

	// ── File Playback ────────────────────────────────────────────────
	_filePlaybackDevice?: FileSdrDevice | null;

	async playFile(opts: FilePlaybackOpts): Promise<boolean> {
		if (this.device) {
			await this.stopRx();
			await this.device.close();
		}
		const device = new FileSdrDevice(opts.data, opts.sampleRate, opts.centerFreq);
		this.device = device;
		this._filePlaybackDevice = device;
		return true;
	}

	stopFilePlayback(): void {
		if (this._filePlaybackDevice) {
			this._filePlaybackDevice.stopRx();
			this._filePlaybackDevice = null;
		}
		if (this.device) {
			this.device.close();
			this.device = null;
		}
	}

	pauseFilePlayback(): void {
		this._filePlaybackDevice?.pause();
	}

	resumeFilePlayback(): void {
		this._filePlaybackDevice?.resume();
	}

	getFilePlaybackPosition(): number {
		return this._filePlaybackDevice?.position ?? 0;
	}

	// ── Generic device control methods ──────────────────────────────

	async setSampleRate(rate: number): Promise<void> {
		if (!this.device) throw new Error('No device connected');
		validateSampleRate(rate, this.device.sampleRates);
		await this.device.setSampleRate(rate);
	}

	/** Tunes the hardware and propagates the new center frequency to all VFO DSP workers. */
	async setFrequency(freqHz: number): Promise<void> {
		if (!this.device) throw new Error('No device connected');
		validateFrequency(freqHz);
		await this.device.setFrequency(freqHz);
		
		this._centerFreq = freqHz / 1e6;

		if (this.vfoParams && this.dspWorkers) {
			for (let i = 0; i < this.vfoParams.length; i++) {
				if (this.dspWorkers[i]) {
					this.dspWorkers[i].postMessage({
						type: 'configure',
						params: this.vfoParams[i],
						centerFreq: this._centerFreq
					});
				}
			}
		}

		if (this._remoteClients) {
			for (const rc of this._remoteClients.values()) {
				if (rc.workers && rc.params) {
					for (let i = 0; i < rc.workers.length; i++) {
						if (rc.workers[i]) {
							rc.workers[i]!.postMessage({
								type: 'configure',
								params: rc.params[i],
								centerFreq: this._centerFreq
							});
						}
					}
				}
			}
		}
	}

	async setGain(name: string, value: number): Promise<void> {
		if (!this.device) throw new Error('No device connected');
		const clamped = clampGain(name, value, this.device.gainControls);
		await this.device.setGain(name, clamped);
	}

	async setGains(gains: Record<string, number>): Promise<void> {
		if (!this.device) throw new Error('No device connected');
		const validated = validateAndClampGains(gains, this.device.gainControls);
		if (this.device.setGains) {
			await this.device.setGains(validated);
		} else {
			for (const [name, value] of Object.entries(validated)) {
				await this.device.setGain(name, value);
			}
		}
	}

	/** Low-level raw IQ callback. Prefer `startRxStream` which wires up the full DSP pipeline. */
	async startRx(callback: any): Promise<void> {
		if (!this.device) throw new Error('No device connected');
		await this.device.startRx(callback);
	}

	async stopRx(): Promise<void> {
		if (!this.device) throw new Error('No device connected');
		await this.device.stopRx();
	}

	async close(): Promise<void> {
		if (!this.device) return;
		await this.device.close();
		this.device = null;
	}
}
