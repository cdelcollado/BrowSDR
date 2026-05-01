import type { SdrDevice, SdrDeviceInfo, DeviceCapabilities, GainControl } from '../sdr-device';

const CHUNK_SAMPLES = 131072;

export class FileSdrDevice implements SdrDevice {
	readonly deviceType = 'FileSDR';
	readonly sampleRates: number[] = [];
	readonly gainControls: GainControl[] = [];
	readonly sampleFormat = 'int16' as const;

	private _data: Int16Array;
	private _sampleRate: number;
	private _centerFreq: number;
	private _readPos = 0;
	private _running = false;
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private _stopResolve: (() => void) | null = null;
	private _paused = false;
	private _pauseResolve: (() => void) | null = null;
	private _callback: ((data: ArrayBufferView) => void) | null = null;

	constructor(data: ArrayBuffer, sampleRate: number, centerFreq: number) {
		this._data = new Int16Array(data);
		this._sampleRate = sampleRate;
		this._centerFreq = centerFreq;
		this.sampleRates = [sampleRate];
	}

	async open(_device: USBDevice): Promise<void> {
	}

	async close(): Promise<void> {
		this.stopRx();
	}

	getInfo(): Promise<SdrDeviceInfo> {
		return Promise.resolve({ name: `FileSDR (${this._sampleRate / 1e6} Msps)` });
	}

	setSampleRate(_rate: number): Promise<void> {
		return Promise.resolve();
	}

	setFrequency(_freqHz: number): Promise<void> {
		return Promise.resolve();
	}

	setGain(_name: string, _value: number): Promise<void> {
		return Promise.resolve();
	}

	startRx(callback: (data: ArrayBufferView) => void): Promise<void> {
		this._callback = callback;
		this._readPos = 0;
		this._running = true;
		this._paused = false;

		return new Promise((resolve) => {
			this._stopResolve = resolve;
			this._scheduleNext();
		});
	}

	stopRx(): Promise<void> {
		this._running = false;
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
		if (this._pauseResolve) {
			this._pauseResolve();
			this._pauseResolve = null;
		}
		if (this._stopResolve) {
			this._stopResolve();
			this._stopResolve = null;
		}
		this._callback = null;
		return Promise.resolve();
	}

	pause(): void {
		this._paused = true;
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}

	resume(): void {
		if (!this._paused) return;
		this._paused = false;
		if (this._running) {
			this._scheduleNext();
		}
	}

	get position(): number {
		return this._readPos;
	}

	get totalSamples(): number {
		return this._data.length;
	}

	get playing(): boolean {
		return this._running && !this._paused;
	}

	private _scheduleNext(): void {
		if (!this._running || this._paused) return;

		const chunkLen = Math.min(CHUNK_SAMPLES * 2, this._data.length - this._readPos);
		if (chunkLen <= 0) {
			this._running = false;
			if (this._stopResolve) {
				this._stopResolve();
				this._stopResolve = null;
			}
			return;
		}

		const chunk = this._data.subarray(this._readPos, this._readPos + chunkLen);
		this._readPos += chunkLen;

		const bytesPerSample = 2;
		const chunkByteLen = chunkLen * bytesPerSample;
		const intervalMs = (chunkByteLen / 2 / this._sampleRate) * 1000;

		if (this._callback) {
			this._callback(new Int16Array(chunk));
		}

		this._timer = setTimeout(() => this._scheduleNext(), Math.max(0, intervalMs));
	}
}
