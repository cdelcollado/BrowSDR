import type { AppInstance } from './types';

export const adsbMethods = {
	toggleAdsbPanel(this: AppInstance) {
		this.adsb.panelOpen = !this.adsb.panelOpen;
	},
	_onAdsbMessage(this: AppInstance, vfoIndex: number, freqMhz: number, msg: any) {
		const time = new Date().toLocaleTimeString();
		this.adsb.log.push({
			time,
			vfoIndex,
			icao: msg.icao || '',
			callsign: msg.callsign || '',
			altitude: msg.altitude || 0,
			speed: msg.speed || 0,
			heading: msg.heading || 0,
			lat: msg.lat || 0,
			lon: msg.lon || 0,
			raw: msg.raw || '',
		});
		this.$nextTick(() => {
			const el = this.$refs.adsbBody;
			if (el) el.scrollTop = el.scrollHeight;
		});
	},
	clearAdsb(this: AppInstance) {
		this.adsb.log = [];
	},
	exportAdsb(this: AppInstance) {
		const lines = this.adsb.log.map((e: any) =>
			`[${e.time}] ICAO:${e.icao}  ${e.callsign ? 'Callsign:' + e.callsign + '  ' : ''}${e.altitude ? 'Alt:' + e.altitude + 'ft  ' : ''}${e.speed ? 'Spd:' + e.speed + 'kt  ' : ''}${e.heading ? 'Hdg:' + e.heading + '°  ' : ''}${e.lat ? 'Pos:' + e.lat.toFixed(4) + ',' + e.lon.toFixed(4) + '  ' : ''}RAW:${e.raw}`
		);
		const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `adsb-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
		a.click();
		URL.revokeObjectURL(url);
	},
};
