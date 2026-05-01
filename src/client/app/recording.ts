import * as Comlink from 'comlink';
import type { AppInstance } from './types';

export const recordingMethods = {
	async startIqRecording(this: AppInstance) {
		if (!this.backend || !this.running) return;
		try {
			const handle = await (window as any).showSaveFilePicker({
				suggestedName: `browsdr_${this.radio.centerFreq}MHz_${Date.now()}.s16`,
				types: [{
					description: 'Raw S16 IQ',
					accept: { 'application/octet-stream': ['.s16'] },
				}],
			});
			const writable = await handle.createWritable();

			this.iqRecording.active = true;
			this.iqRecording.startTime = Date.now();
			this.iqRecording.duration = 0;
			this.iqRecording.fileHandle = handle;
			this.iqRecording.writable = writable;
			this._iqRecordDurationTimer = setInterval(() => {
				if (this.iqRecording.startTime) {
					this.iqRecording.duration = Math.floor((Date.now() - this.iqRecording.startTime) / 1000);
				}
			}, 1000);

			await this.backend.setIqRecording(true, Comlink.proxy((chunk: Int16Array) => {
				writable.write(chunk.buffer).catch(() => {});
			}));
		} catch {
			// User cancelled or error
		}
	},

	async stopIqRecording(this: AppInstance) {
		if (!this.iqRecording.active) return;
		this.iqRecording.active = false;
		if (this._iqRecordDurationTimer) {
			clearInterval(this._iqRecordDurationTimer);
			this._iqRecordDurationTimer = null;
		}
		await this.backend.setIqRecording(false, null);
		try {
			await this.iqRecording.writable.close();
		} catch {}
		this.iqRecording.writable = null;
		this.iqRecording.fileHandle = null;
		this.iqRecording.startTime = null;
	},

	async playFromFile(this: AppInstance) {
		if (!this.backend) return;
		try {
			const [handle] = await (window as any).showOpenFilePicker({
				types: [{
					description: 'Raw S16 IQ',
					accept: { 'application/octet-stream': ['.s16'] },
				}],
				multiple: false,
			});
			const file = await handle.getFile();
			const buf = await file.arrayBuffer();

				this.iqPlaying = true;
			await this.backend.playFile({
				data: buf,
				sampleRate: this.radio.sampleRate,
				centerFreq: this.radio.centerFreq,
				format: 's16',
			});
			await this.startStream();
		} catch {
			// User cancelled
		}
	},

	async stopFilePlayback(this: AppInstance) {
		this.iqPlaying = false;
		if (this.running) await this.togglePlay();
		await this.backend.stopFilePlayback();
		if (this.connected) {
			this.connected = false;
		}
	},

	async pauseFilePlayback(this: AppInstance) {
		await this.backend.pauseFilePlayback();
		this.iqPlaying = false;
	},

	async resumeFilePlayback(this: AppInstance) {
		await this.backend.resumeFilePlayback();
		this.iqPlaying = true;
	},
};
