export interface ADSBMessage {
	icao: string;
	tc: number;
	callsign?: string;
	altitude?: number;
	lat?: number;
	lon?: number;
	speed?: number;
	heading?: number;
	vs?: number;
	raw: string;
}

const MODE_S_CRC_POLY = 0xFFF409;
const MODE_S_LONG_BITS = 112;
const MODE_S_LONG_BYTES = 14;

// Mode S preamble at 2 MSPS (0.5 µs per sample):
// pulses at 0.0, 1.0, 3.5, 4.5 µs → samples [0, 2, 7, 9]
const PREAMBLE_LEN = 10;
// Convolution kernel: marker at pulse positions, negative elsewhere
const PREAMBLE_KERNEL = new Float32Array([1, -0.2, 1, -0.2, -0.2, -0.2, -0.2, 1, -0.2, 1]);

// CRC24 lookup table
const crc24Table = new Uint32Array(256);
{
	for (let i = 0; i < 256; i++) {
		let crc = i << 16;
		for (let j = 0; j < 8; j++) {
			crc <<= 1;
			if (crc & 0x1000000) crc ^= MODE_S_CRC_POLY;
		}
		crc24Table[i] = crc & 0xFFFFFF;
	}
}

function crc24(msg: Uint8Array, offset: number, byteLen: number): number {
	let crc = 0;
	for (let i = offset; i < offset + byteLen; i++) {
		const idx = ((crc >> 16) ^ msg[i]) & 0xFF;
		crc = crc24Table[idx] ^ ((crc << 8) & 0xFFFFFF);
	}
	return crc;
}

function toHex(v: number, len: number): string {
	return v.toString(16).toUpperCase().padStart(len, '0');
}

function icaoChars(callsign: string): string {
	return callsign.replace(/[\x00-\x1f]/g, '').trim();
}

function decodeAltitude(me: number): number | undefined {
	// ME bits 1-12 (12-bit altitude field)
	const altField = (me >> 1) & 0xFFF;
	const qBit = (altField >> 4) & 1;
	if (qBit) {
		// 25-ft encoding
		const n = ((altField >> 5) & 0x7F) | ((altField & 0xF) << 7);
		if (n === 0) return undefined;
		return (n * 25) - 1000;
	}
	// 100-ft Gray code encoding
	const gray = altField & 0xFFF;
	const val = (gray >> 1) ^ gray;
	const decoded: number[] = [];
	for (let i = 0; i < 12; i++) {
		decoded.push((gray >> (11 - i)) & 1);
	}
	// Decode D1-D4 bits for 100-ft encoding
	const d1 = (gray >> 11) & 1;
	const d2 = (gray >> 10) & 1;
	const d4 = (gray >> 8) & 1;
	const a1 = (gray >> 7) & 1;
	const a2 = (gray >> 6) & 1;
	const a4 = (gray >> 4) & 1;
	const b1 = (gray >> 3) & 1;
	const b2 = (gray >> 2) & 1;
	const b4 = (gray >> 0) & 1;
	const c1 = (gray >> 9) & 1;
	const c2 = (gray >> 5) & 1;
	const c4 = (gray >> 1) & 1;

	const bits = [
		d1, d2, 0, d4,
		a1, a2, 0, a4,
		b1, b2, 0, b4,
		c1, c2, 0, c4,
	];
	let alt = 0;
	for (let i = 0; i < 12; i++) {
		if (i === 0 && bits[i]) alt -= 1200;
		else if (bits[i]) alt += 500 * (1 << (i - 1));
	}
	return alt;
}

function decodeCallsign(me: number): string {
	const chars: number[] = [];
	for (let i = 0; i < 8; i++) {
		chars.push((me >> (42 - i * 6)) & 0x3F);
	}
	const alphabet = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######';
	let result = '';
	for (const c of chars) {
		const ch = alphabet.charAt(c);
		if (ch !== '#') result += ch;
	}
	return result.trim();
}

function decodeCompactPosition(me: number): { lat: number; lon: number } | undefined {
	const cprLat = (me >> 30) & 0x3FFFF;
	const cprLon = me & 0x3FFFF;
	if (cprLat === 0 || cprLon === 0) return undefined;

	const nz = 15;
	const dLat = 360.0 / (4 * nz);
	const latIdx = Math.floor((cprLat / 131072.0) * (4 * nz));
	const lonRef = 0; // relative decoding: first message gives reference

	const lat = dLat * (latIdx + (cprLat / 131072.0));
	const nl = Math.floor(2 * Math.PI / Math.acos(1 - (1 - Math.cos(Math.PI / (2 * nz))) / Math.cos(lat * Math.PI / 180)));
	const dLon = 360.0 / Math.max(nl, 1);
	const lonIdx = Math.floor((cprLon / 131072.0) * Math.max(nl, 1));

	return {
		lat: Math.round(lat * 10000) / 10000,
		lon: Math.round((dLon * (lonIdx + cprLon / 131072.0)) * 10000) / 10000,
	};
}

function decodeVelocity(me: number): { speed: number; heading: number; vs: number } | undefined {
	const subtype = (me >> 3) & 7;
	if (subtype === 1 || subtype === 2) {
		// Ground speed + track heading
		const ew = (me >> 2) & 1;
		const ns = (me >> 1) & 1;
		const vew = (me >> 13) & 0x3FF;
		const vns = (me >> 23) & 0x3FF;
		const heading = (me >> 33) & 0x3FF;
		return {
			speed: Math.sqrt(vew * vew + vns * vns),
			heading: heading * 360 / 1024,
			vs: 0,
		};
	}
	return undefined;
}

export class ADSDecoder {
	private rate: number;
	private onMessage: (msg: ADSBMessage) => void;
	private overlapBuf: Float32Array;
	private overlapLen: number;
	private overlapCapacity: number;

	constructor(rate: number, onMessage: (msg: ADSBMessage) => void) {
		this.rate = rate;
		this.onMessage = onMessage;
		this.overlapCapacity = PREAMBLE_LEN + MODE_S_LONG_BITS * 2 + 32;
		this.overlapBuf = new Float32Array(this.overlapCapacity);
		this.overlapLen = 0;
	}

	process(iqPairs: Float32Array): void {
		const numSamples = iqPairs.length / 2;
		if (numSamples < 240) return;

		// Compute magnitude with rough sqrt approximation
		const mag = new Float32Array(numSamples);
		for (let i = 0; i < numSamples; i++) {
			const re = iqPairs[i * 2];
			const im = iqPairs[i * 2 + 1];
			mag[i] = Math.sqrt(re * re + im * im);
		}

		// Normalize magnitude using a rolling maximum
		let maxMag = 0;
		for (let i = 0; i < mag.length; i++) {
			if (mag[i] > maxMag) maxMag = mag[i];
		}
		if (maxMag < 1e-6) return;

		// Dynamic threshold from signal level
		const noiseFloor = this._estimateNoiseFloor(mag);
		const threshold = noiseFloor * 3.0;

		// Convolve with preamble kernel
		const convLen = numSamples - PREAMBLE_LEN + 1;
		const maxConvLen = 4096;
		const conv = new Float32Array(Math.min(convLen, maxConvLen));

		for (let i = 0; i < conv.length; i++) {
			let sum = 0;
			for (let j = 0; j < PREAMBLE_LEN; j++) {
				sum += (mag[i + j] / maxMag) * PREAMBLE_KERNEL[j];
			}
			conv[i] = sum * 100;
		}

		// Detect preamble peaks
		let lastPeakAt = -1000;
		for (let i = 0; i < conv.length - 2; i++) {
			if (conv[i] > 150 && conv[i] > conv[i - 1] && conv[i] > conv[i + 1]) {
				// Avoid duplicate detection within 200 samples
				if (i - lastPeakAt < 200) continue;
				lastPeakAt = i;

				const byteMsg = new Uint8Array(MODE_S_LONG_BYTES);
				const bitStart = i; // preamble end = data start
				const bitsNeeded = MODE_S_LONG_BITS;

				if (bitStart + bitsNeeded * 2 + PREAMBLE_LEN > numSamples) continue;

				// Extract PPM bits (2 samples per bit)
				for (let b = 0; b < bitsNeeded; b++) {
					const s1 = mag[bitStart + PREAMBLE_LEN + b * 2];
					const s2 = mag[bitStart + PREAMBLE_LEN + b * 2 + 1];
					// PPM: 1 = high first, 0 = high second
					const bit = s1 >= s2 ? 1 : 0;
					const byteIdx = Math.floor(b / 8);
					const bitIdx = 7 - (b % 8);
					byteMsg[byteIdx] |= bit << bitIdx;
				}

				// Check CRC (first 11 bytes for long Mode S, 7 bytes for short)
				const df = (byteMsg[0] >> 3) & 0x1F;
				const crcBytes = (df === 11) ? 7 : 11; // DF11 = short, rest = long
				const expectedCrc = (byteMsg[crcBytes] << 16) | (byteMsg[crcBytes + 1] << 8) | byteMsg[crcBytes + 2];
				const computedCrc = crc24(byteMsg, 0, crcBytes);

				if (expectedCrc !== computedCrc) continue;

				// Parse message
				const icao = toHex((byteMsg[1] << 16) | (byteMsg[2] << 8) | byteMsg[3], 6);

				if (df === 17 || df === 18) {
					// ADS-B (Extended Squitter)
					const me = (byteMsg[4] << 16) | (byteMsg[5] << 8) | byteMsg[6];
					const tc = (me >> 3) & 0x1F;
					const raw = Array.from(byteMsg).map(b => toHex(b, 2)).join('');

					const msg: ADSBMessage = { icao, tc, raw };

					if (tc >= 1 && tc <= 4) {
						msg.callsign = icaoChars(decodeCallsign(me));
					} else if (tc >= 9 && tc <= 18) {
						msg.altitude = decodeAltitude(me);
						const pos = decodeCompactPosition(me);
						if (pos) {
							msg.lat = pos.lat;
							msg.lon = pos.lon;
						}
					} else if (tc === 19) {
						const vel = decodeVelocity(me);
						if (vel) {
							msg.speed = Math.round(vel.speed);
							msg.heading = Math.round(vel.heading);
							msg.vs = vel.vs;
						}
					}

					this.onMessage(msg);
				}
			}
		}
	}

	private _estimateNoiseFloor(mag: Float32Array): number {
		// Use bottom 20th percentile as noise estimate
		const sorted = new Float32Array(Math.min(mag.length, 1000));
		const step = Math.max(1, Math.floor(mag.length / sorted.length));
		for (let i = 0; i < sorted.length; i++) {
			sorted[i] = mag[i * step];
		}
		sorted.sort();
		const idx = Math.floor(sorted.length * 0.2);
		return sorted[idx] || 1e-6;
	}
}
