# Raw AVR decoder

`AvrParser` accepts Buffer/string chunks, including split frames and several
frames per chunk. It emits uppercase Mode S hex through `onFrame(hex)`:

- `*HEX;` (14 or 28 hex digits)
- `@TTTTTTTTTTTTHEX;` and `%TTTTTTTTTTTTHEX;` (12 hex timestamp digits)
- `<TTTTTTTTTTTTSSHEX;` (12 hex timestamp digits, 2 hex signal digits)

Timestamp/signal prefixes are checked and discarded; tracking uses the supplied
reception time in milliseconds. A `%` prefix does **not** bypass CRC checking.
The dump1090 `*0000;` idle heartbeat is ignored. Other malformed frames report a
stable reason through `onInvalid(reason)`. A candidate is limited to the smaller
of `maxBufferBytes` and 43 ASCII bytes; unrelated noise is never accumulated.
Parsing is linear in chunk length. `reset()` discards partial frames.

`AdsbTracker.ingest(hex, now)` returns true for an accepted message. Supported:

- CRC-valid 112-bit DF17, and DF18 **CF0 only**, with an explicit nonzero ICAO
  address other than the reserved `ffffff` value.
- TC1–4: identification and category.
- TC5–8: surface movement/track. No surface coordinates are produced without a
  receiver/airfield reference; ground reports clear earlier airborne positions.
- TC9–18: barometric altitude with Q=1 (25-foot encoding), airborne global CPR.
  Q=0 Gillham altitude is left unknown.
- TC20–22: GNSS height, decoded as meters and returned separately as `alt_geom`
  in feet; it is never substituted for `alt_baro`. Airborne global CPR is supported.
- TC19 subtypes 1/2: ground speed/true track, including 4-knot subtype 2 scaling.
  Subtypes 3/4: separate IAS/TAS and magnetic heading, never ground speed/track.
  Vertical rates retain their barometric/GNSS source and feet/minute units.

CPR requires same-aircraft, opposite-parity reports from the same altitude source
within 10 seconds. Reconstructed latitude range and matching longitude-zone
counts are checked. The newer frame chooses the final position. No local CPR,
surface CPR, reference-station range validation or physical flight-path filtering
is attempted. CRC damage is rejected, never corrected.

Other Mode S DFs, TIS-B/ADS-R/anonymous DF18 forms and unsupported ADS-B type codes
are ignored and create no aircraft. Unknown numeric fields are null. Last known
positions expose their age as `seen_pos`; receiving identification alone does
not refresh it. Older injected reception timestamps are rejected.

`snapshot(now)` returns dump1090-style `{ now, messages, aircraft }`, with `now`,
`seen` and `seen_pos` in seconds. `messages` counts accepted messages in this
supported subset, rather than every raw receiver frame. Aircraft expire after
`ttlMs` without accepted reception; capacity evicts the least recently received
aircraft. `clear()` clears aircraft and accepted-message counters.

Protocol/algorithm references and real golden frames used in the tests:

- [dump1090 AVR network source](https://github.com/flightaware/dump1090/blob/master/net_io.c)
- [dump1090 DF18 and ADS-B field semantics](https://github.com/flightaware/dump1090/blob/master/mode_s.c)
- [pyModeS identification fixture](https://github.com/junzis/pyModeS/blob/master/tests/test_adsb.py)
- [1090 MHz Riddle airborne position](https://mode-s.org/1090mhz/content/ads-b/3-airborne-position.html)
- [1090 MHz Riddle airborne velocity](https://mode-s.org/1090mhz/content/ads-b/5-airborne-velocity.html)
- [1090 MHz Riddle surface position](https://mode-s.org/1090mhz/content/ads-b/4-surface-position.html)
