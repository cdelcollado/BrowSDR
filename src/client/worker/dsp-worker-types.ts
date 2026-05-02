import type { VfoParams } from './types';
import type { RationalResampler } from './dsp-pipeline';

export type DspWorkerInMessage =
    | { type: 'init'; sampleRate: number; centerFreq: number; params: VfoParams; sabs: (SharedArrayBuffer | ArrayBuffer)[] | null }
    | { type: 'configure'; params: VfoParams; centerFreq: number }
    | { type: 'process'; params: VfoParams; useSab: true; sabIndex: number; chunkLen: number; chunkId: number }
    | { type: 'process'; params: VfoParams; useSab: false; chunk: ArrayBuffer; chunkLen: number; chunkId: number };

export type DspWorkerOutMessage =
	| { type: 'init_done' }
	| { type: 'config_done' }
	| { type: 'audio'; samples: ArrayBuffer | null; chunkId: number; squelchOpen: boolean; squelchDb: number; dspTime: number }
	| { type: 'adsb'; msgs: import('./types').ADSBDecodedMessage[]; chunkId: number }
	| { type: 'error'; error: string };

export interface DspWorkerVfoState {
    dcAvg: number;
    carrierAgcGain: number;
    deemphPrev: number;
    agcGain: number;
    ssbPhase: number;
    audioResampler: RationalResampler | null;
    currentIfRate: number;
    scratchBuf: Float32Array;
    audioTarget: Float32Array;
    squelchOpen: boolean;
    squelchDb: number;
}
