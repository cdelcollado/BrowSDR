# Planned features

Requested features for future BrowSDR development. Unchecked items are not yet
implemented; the list does not set priorities or release dates.

- [x] **Radiosonde (initial RS41 GPS support)** — Decode balloon position, altitude, movement and battery with a live map. See the [reception guide](radiosonde.md) for scope and limitations.
- [ ] **Additional radiosonde support** — Calibrated temperature, humidity and pressure, error correction, and other sonde models.
- [x] **ACARS (initial VHF support)** — Decode aircraft operational messages (Aircraft Communications Addressing and Reporting System), with a searchable message list. See the [reception guide](acars.md) for scope and limitations.
- [x] **APRS (initial 1200-baud support)** — Decode amateur radio position reports, messages, weather and telemetry (Automatic Packet Reporting System), with a live map. See the [reception guide](aprs.md) for scope and limitations.
- [x] **AIS (initial Class A/B support)** — Decode vessel identification, position and movement reports on both AIS channels, with a live map and ITU MID country lookup. See the [reception guide](ais.md) for scope and limitations.
- [x] **ADS-B (initial 1090ES support)** — Decode aircraft identification, airborne position, altitude, and ground velocity, with a live map. See the [reception guide](adsb.md) for scope and limitations.
- [x] **BLE (initial legacy LE 1M support)** — Passively decode nearby advertisements with fixed-channel listening or three-channel scanning and a live device list. See the [reception guide](ble.md) for hardware requirements and limitations.
- [ ] **CW (Morse) decoder** — Decode Morse text from the CW mode with automatic speed tracking and a scrolling transcript. Not yet implemented; the CW mode currently provides demodulation only.
- [ ] **RTTY and PSK31 text decoding** — Decode amateur radio teletype and PSK31 text from SSB or narrow-band audio, sharing the demodulation front end where possible.
- [ ] **Track export (GPX, KML, CSV)** — Export ADS-B, AIS, APRS and radiosonde tracks from the live views and session history to standard formats for use in other tools.
- [ ] **Per-VFO audio recording (WAV)** — Record the demodulated audio of a single VFO to a WAV file, complementing the existing IQ recording and replay.
- [ ] **Bookmark scanner** — Cycle through bookmarked frequencies with squelch, pausing on activity and resuming after a configurable hold time.
- [ ] **Additional radiosonde models** — Extend radiosonde reception beyond RS41 and add calibrated temperature, humidity and pressure where the sonde format provides them.
- [ ] **NOAA APT weather satellite images** — Demodulate APT transmissions from NOAA polar-orbiting satellites and display the scan lines as a live image with a saved history.
- [ ] **FT8 and FT4 decoding** — Decode the WSJT-X digital modes used on HF, with time synchronisation and a decoded message list. Large effort: planned as a separate project.
