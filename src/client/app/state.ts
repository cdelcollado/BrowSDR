import { makeDefaultVfo, BOOKMARK_CATEGORIES } from './constants';
import type {
	Bookmark, BookmarkModal, BookmarkImportModal, BookmarkEdit, BookmarkCategory,
	WhisperState, PocsagState, AdsbState, RadioState, DisplayState, ViewState,
	VfoConflictDialog, Snackbar, Vfo,
	RemoteClientEntry, DevicePickerEntry, VfoActivityStat, DspStats, IqRecordingState,
} from './types';
import type { DeviceCapabilities } from '../sdr-device';

// ── Slice helpers ────────────────────────────────────────────────
// Each function owns one logical section of app state. createAppData()
// spreads them into the flat object that Vue's Options API data() expects.

function remoteSlice() {
	return {
		remoteMode: 'none' as 'none' | 'host' | 'client',
		remoteStatus: '',
		remoteLink: '',
		copyLinkSuccess: false,
		copyLinkTooltip: 'Copy link',
		remoteClients: [] as RemoteClientEntry[],
		showRemoteClientsDialog: false,
		showRemoteConnectDialog: false,
		remoteConnectId: '',
		recentRemoteIds: [] as string[],
		remotePeerId: '',
	};
}

function vfoSlice(centerFreq: number) {
	return {
		vfos: [makeDefaultVfo(centerFreq)],
		activeVfoIndex: 0,
		vfoSquelchOpen: [] as boolean[],
		vfoSquelchHangUntil: [] as number[],
		vfoActivityStats: [] as VfoActivityStat[],
		autoSquelchSamples: [] as Array<number[]>,
		autoSquelchActive: [] as boolean[],
		activityNow: 0,
		showActivity: false,
	};
}

function bookmarkSlice() {
	return {
		bookmarkCategories: BOOKMARK_CATEGORIES as BookmarkCategory[],
		bookmarkCategoryFilter: '',
		bookmarkSearch: '',
		bookmarks: [] as Bookmark[],
		syncToken: '' as string,
		bookmarkModal: { show: false, type: 'individual', name: '', category: '' } as BookmarkModal,
		bookmarkImportModal: { show: false } as BookmarkImportModal,
		bookmarkEdit: {
			show: false,
			index: -1,
			type: 'individual',
			name: '',
			category: '',
			freq: 100.0,
			mode: 'nfm',
			bandwidth: 12500,
			snapInterval: 2500,
			deEmphasis: 'none',
			squelchEnabled: false,
			squelchLevel: -100,
			noiseReduction: false,
			stereo: false,
			lowPass: true,
			highPass: false,
			rds: false,
			rdsRegion: 'eu',
			volume: 50,
			centerFreq: 100.0,
			sampleRate: 8000000,
			vfos: [] as Vfo[],
			activeVfoIndex: 0,
		} as BookmarkEdit,
	};
}

// ── Public factory ───────────────────────────────────────────────

export function createAppData() {
	const centerFreq = 100.0;
	return {
		// backend is a Comlink.Remote<Backend> at runtime; typed via AppInstance = any
		backend: null as any,
		connected: false,
		running: false,
		isOnline: navigator.onLine,

		...remoteSlice(),

		snackbar: { show: false, message: '' } as Snackbar,
		audioUnlockPendingId: null as string | null,

		radio: {
			centerFreq,
			sampleRate: 20_000_000,
			fftSize: 65536,
		} as RadioState,

		display: { minDB: -70.0, maxDB: 0.0 } as DisplayState,

		gains: {} as Record<string, number>,
		deviceCapabilities: null as DeviceCapabilities | null,
		locks: { centerFreq: false, sampleRate: false } as Record<string, boolean>,

		...vfoSlice(centerFreq),

		info: { boardName: '' },
		hoverFreqText: '',
		dspStats: null as DspStats | null,
		showStats: false,
		fps: 0,

		view: { zoomScale: 1.0, zoomOffset: 0.0, locked: false } as ViewState,

		whisper: {
			panelOpen: false,
			active: false,
			status: 'idle' as string,
			loadProgress: 0,
			loadPhase: 'downloading' as string,
			loadFile: '',
			loadFilesDone: 0,
			loadFilesTotal: 0,
			model: 'onnx-community/whisper-small',
			chunkSeconds: 10,
			log: [] as WhisperState['log'],
			statusMsg: '',
			recording: false,
			transcribing: false,
			recordStart: null as Date | null,
			recordDuration: 0,
			pendingChunks: 0,
		} as WhisperState,

		pocsag: {
			panelOpen: false,
			log: [] as PocsagState['log'],
		} as PocsagState,

		adsb: {
			panelOpen: false,
			log: [] as AdsbState['log'],
		} as AdsbState,

		...bookmarkSlice(),

		devicePicker: {
			show: false,
			devices: [] as DevicePickerEntry[],
		},

		iqRecording: {
			active: false,
			startTime: null as number | null,
			duration: 0,
			fileHandle: null,
			writable: null,
		} as IqRecordingState,
		iqPlaying: false,

		sidebarOpen: false,
		showAbout: false,
		collapsedPanels: {} as Record<string, boolean>,

		vfoConflictDialog: {
			show: false,
			vfoIndex: -1,
			requestedFreq: 0,
			previousFreq: 0,
			optionA: null,
			optionB: null,
		} as VfoConflictDialog,
	};
}
