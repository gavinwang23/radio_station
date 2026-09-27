import test from 'node:test';
import assert from 'node:assert/strict';
import { AvrParser } from '../src/modules/adsb/decoder/avr-parser.js';
import { AdsbTracker } from '../src/modules/adsb/decoder/aircraft-tracker.js';

// Golden frames and literal expectations: Junzi Sun's 1090 MHz Riddle and
// https://github.com/junzis/pyModeS/blob/master/tests/test_adsb.py.
const IDENT = '8D406B902015A678D4D220AA4BDA';
const EVEN = '8D40621D58C382D690C8AC2863A7';
const ODD = '8D40621D58C386435CC412692AD6';
const VELOCITY = '8D485020994409940838175B284F';
const AIRSPEED = '8DA05F219B06B6AF189400CBC33F';
const SURFACE_EVEN = '8C4841753AAB238733C8CD4020B1';
const SURFACE_ODD = '8C4841753A8A35323FAEBDAC702D';
const SHORT = '5D484FDEA248F5';

// Test-only message construction uses polynomial long division, independent of
// the production byte-by-byte CRC. Bit indices are 1-based ICAO message bits.
function withFields(hex, fields) {
  let value = BigInt(`0x${hex}`) & ~0xffffffn;
  for (const [start, end, field] of fields) {
    const width = BigInt(end - start + 1);
    const shift = BigInt(112 - end);
    const mask = ((1n << width) - 1n) << shift;
    value = (value & ~mask) | (BigInt(field) << shift);
  }
  let remainder = value;
  for (let bit = 111; bit >= 24; bit--) {
    if (remainder & (1n << BigInt(bit))) remainder ^= 0x1fff409n << BigInt(bit - 24);
  }
  return (value | remainder).toString(16).padStart(28, '0').toUpperCase();
}
const aircraft = (tracker, now = 1000) => tracker.snapshot(now).aircraft[0];
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('AVR accepts split and coalesced short/long frames with all dump1090 ASCII metadata', () => {
  const frames = [], invalid = [];
  const parser = new AvrParser({ onFrame: hex => frames.push(hex), onInvalid: reason => invalid.push(reason) });
  parser.push(Buffer.from(`noise\r\n*${IDENT.slice(0, 8)}`));
  parser.push(`${IDENT.slice(8).toLowerCase()};\r\n@0123456789AB${EVEN};%0123456789ab${ODD};`);
  parser.push(`<0123456789AB7F${SHORT};*${VELOCITY};`);
  assert.deepEqual(frames, [IDENT, EVEN, ODD, SHORT, VELOCITY]);
  assert.deepEqual(invalid, []);
});

test('AVR splits correctly at every byte boundary', () => {
  for (const prefix of ['*', '@0123456789AB', '%0123456789AB', '<0123456789AB7F']) {
    const wire = `${prefix}${IDENT};`;
    for (let split = 1; split < wire.length; split++) {
      const frames = [];
      const parser = new AvrParser({ onFrame: hex => frames.push(hex) });
      parser.push(wire.slice(0, split));
      parser.push(wire.slice(split));
      assert.deepEqual(frames, [IDENT]);
    }
  }
});

test('AVR rejects malformed lengths, metadata and non-hex without poisoning following frames', () => {
  const frames = [], invalid = [];
  const parser = new AvrParser({ onFrame: hex => frames.push(hex), onInvalid: reason => invalid.push(reason) });
  parser.push(`*bad;@G123456789AB${EVEN};<0123456789ABGG${EVEN};*${EVEN}00;*${ODD.slice(0, -1)};*${IDENT};`);
  assert.deepEqual(frames, [IDENT]);
  assert.ok(invalid.length >= 5);
});

test('AVR bounds incomplete/noisy data, recovers at a fresh marker and resets fragments', () => {
  const frames = [], invalid = [];
  const parser = new AvrParser({ onFrame: hex => frames.push(hex), onInvalid: reason => invalid.push(reason), maxBufferBytes: 64 });
  parser.push('z'.repeat(1_000_000));
  parser.push('*' + 'F'.repeat(1_000_000));
  parser.push(`*${IDENT};*${EVEN.slice(0, 12)}`);
  parser.reset();
  parser.push(`${EVEN.slice(12)};*${ODD};*0000;\n`);
  assert.deepEqual(frames, [IDENT, ODD]);
  assert.equal(invalid.length, 1);
});

test('AVR enforces a small configured buffer limit without retaining overlong candidates', () => {
  const frames = [], invalid = [];
  const parser = new AvrParser({ onFrame: hex => frames.push(hex), onInvalid: reason => invalid.push(reason), maxBufferBytes: 16 });
  parser.push(`*${IDENT};*${SHORT};`);
  assert.deepEqual(frames, [SHORT]);
  assert.equal(invalid.length, 1);
});

test('ADS-B decodes a real identification with honest unknown values and snapshot seconds', () => {
  const tracker = new AdsbTracker();
  assert.equal(tracker.ingest(IDENT.toLowerCase(), 1000), true);
  const snapshot = tracker.snapshot(2500);
  assert.equal(snapshot.now, 2.5);
  assert.equal(snapshot.messages, 1);
  assert.equal(snapshot.aircraft.length, 1);
  const target = snapshot.aircraft[0];
  assert.equal(target.hex, '406b90');
  assert.equal(target.flight.trim(), 'EZY85MH');
  assert.equal(target.messages, 1);
  assert.equal(target.seen, 1.5);
  assert.equal(target.alt_baro, null);
  assert.equal(target.gs, null);
  assert.equal(target.track, null);
  assert.equal(target.lat, null);
  assert.equal(target.lon, null);
  target.flight = 'changed';
  assert.equal(aircraft(tracker).flight.trim(), 'EZY85MH');
});

test('ADS-B validates CRC and ICAO addresses; unsupported DFs/TCs never invent a target', () => {
  const tracker = new AdsbTracker();
  const invalidFrames = [IDENT.slice(0, -1) + 'B', 'not hex', IDENT.slice(0, -2), SHORT,
    withFields(IDENT, [[1, 5, 20]]), withFields(IDENT, [[33, 37, 31]]),
    withFields(IDENT, [[9, 32, 0]]), withFields(IDENT, [[9, 32, 0xffffff]])];
  for (const hex of invalidFrames) assert.equal(tracker.ingest(hex, 1000), false, hex);
  assert.deepEqual(tracker.snapshot(1000), { now: 1, messages: 0, aircraft: [] });
  assert.equal(tracker.ingest(IDENT, 1000), true);
  assert.equal(tracker.snapshot(1000).messages, 1);
});

test('DF18 accepts only CF0 explicit ICAO ADS-B and rejects anonymous/TIS-B/ADS-R/control variants', () => {
  const tracker = new AdsbTracker();
  for (let cf = 1; cf <= 7; cf++) {
    assert.equal(tracker.ingest(withFields(IDENT, [[1, 5, 18], [6, 8, cf]]), 1000), false);
  }
  assert.equal(tracker.ingest(withFields(IDENT, [[1, 5, 18], [6, 8, 0]]), 1000), true);
  assert.equal(aircraft(tracker).flight.trim(), 'EZY85MH');
});

test('Q-bit barometric altitude and airborne even/odd CPR match authoritative golden frames', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(ODD, 1000);
  assert.equal(aircraft(tracker).alt_baro, 38000);
  assert.equal(aircraft(tracker).lat, null);
  tracker.ingest(EVEN, 3000);
  const target = aircraft(tracker, 4500);
  near(target.lat, 52.2572021484375);
  near(target.lon, 3.91937255859375);
  assert.equal(target.seen_pos, 1.5);
  assert.equal(target.messages, 2);
});

test('CPR chooses the newer odd position and supports the exact ten-second pairing boundary', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(EVEN, 1000);
  tracker.ingest(ODD, 11000);
  near(aircraft(tracker, 11000).lat, 52.26578017412606);
  near(aircraft(tracker, 11000).lon, 3.938912527901786);
});

test('CPR never pairs same parity, different aircraft, expired frames or mixed baro/GNSS messages', () => {
  const cases = [
    [[EVEN, 1000], [EVEN, 2000]],
    [[EVEN, 1000], [withFields(ODD, [[9, 32, 0x406b90]]), 2000]],
    [[EVEN, 1000], [ODD, 11001]],
    [[EVEN, 1000], [withFields(ODD, [[33, 37, 20]]), 2000]],
  ];
  for (const sequence of cases) {
    const tracker = new AdsbTracker();
    for (const [hex, now] of sequence) tracker.ingest(hex, now);
    for (const target of tracker.snapshot(12000).aircraft) assert.equal(target.lat, null);
  }
});

test('CPR rejects latitude outside the physical range and pairs with different longitude-zone counts', () => {
  // Hand-selected encoded pairs: first pair reconstructs 120 degrees; second
  // straddles the NL=36/35 boundary at 53.095 degrees (53.09 vs 53.10).
  for (const [evenLat, oddLat] of [[0, 87381], [111192, 92078]]) {
    const tracker = new AdsbTracker();
    tracker.ingest(withFields(EVEN, [[55, 71, evenLat]]), 1000);
    tracker.ingest(withFields(ODD, [[55, 71, oddLat]]), 2000);
    assert.equal(aircraft(tracker, 2000).lat, null);
  }
});

test('CPR preserves southern/western hemispheres, dateline longitude and polar zones', () => {
  // Encoded fixtures independently rounded from the public CPR encoder equations.
  for (const fixture of [
    { evenLat: 65536, oddLat: 77551, evenLon: 36409, oddLon: 61895, lat: -33, lon: -70 },
    { evenLat: 0, oddLat: 0, evenLon: 44055, oddLon: 109955, lat: 0, lon: 179 },
    { evenLat: 87381, oddLat: 55342, evenLon: 65900, oddLon: 65900, lat: 88, lon: -179 },
  ]) {
    const tracker = new AdsbTracker();
    tracker.ingest(withFields(ODD, [[55, 71, fixture.oddLat], [72, 88, fixture.oddLon]]), 1000);
    tracker.ingest(withFields(EVEN, [[55, 71, fixture.evenLat], [72, 88, fixture.evenLon]]), 2000);
    near(aircraft(tracker, 2000).lat, fixture.lat, 0.0001);
    near(aircraft(tracker, 2000).lon, fixture.lon, 0.002);
  }
});

test('non-ASCII AVR noise cannot be masked into an apparently valid hex frame', () => {
  const frames = [];
  const parser = new AvrParser({ onFrame: hex => frames.push(hex) });
  const damaged = Buffer.from(`*${IDENT};`);
  damaged[1] |= 0x80;
  parser.push(damaged);
  parser.push(`*${IDENT};`);
  assert.deepEqual(frames, [IDENT]);
});

test('tracker discards older reception times without making old values current', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(ODD, 2000);
  assert.equal(tracker.ingest(EVEN, 1000), false);
  assert.equal(aircraft(tracker, 3000).seen, 1);
  assert.equal(aircraft(tracker, 3000).messages, 1);
  assert.equal(aircraft(tracker, 3000).lat, null);
});

test('Q0 Gillham and absent altitude do not get misdecoded with the 25-foot Q1 formula', () => {
  for (const altitudeCode of [0, 0xc28]) {
    const tracker = new AdsbTracker();
    tracker.ingest(withFields(EVEN, [[41, 52, altitudeCode]]), 1000);
    assert.equal(aircraft(tracker).alt_baro, null);
  }
});

test('GNSS height retains its distinct source and converts encoded meters to feet', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(withFields(EVEN, [[33, 37, 20], [41, 52, 1000]]), 1000);
  const target = aircraft(tracker);
  assert.equal(target.alt_baro, null);
  near(target.alt_geom, 3280.839895013123);
});

test('real ground velocity keeps knots, true track and signed GNSS vertical rate', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(VELOCITY, 1000);
  const target = aircraft(tracker);
  near(target.gs, 159.20113064925135);
  near(target.track, 182.8803775528476);
  assert.equal(target.geom_rate, -832);
  assert.equal(target.baro_rate, null);
  assert.equal(target.vert_rate, -832);
});

test('real airspeed subtype is TAS, never ground speed or a ground-track heading', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(AIRSPEED, 1000);
  const target = aircraft(tracker);
  assert.equal(target.tas, 375);
  assert.equal(target.ias, null);
  assert.equal(target.gs, null);
  assert.equal(target.track, null);
  near(target.mag_heading, 243.984375);
  assert.equal(target.baro_rate, -2304);
});

test('velocity unknown components, heading status and rate remain unknown; zero speed has no track', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(withFields(VELOCITY, [[47, 56, 0], [70, 78, 0]]), 1000);
  let target = aircraft(tracker);
  assert.equal(target.gs, null);
  assert.equal(target.track, null);
  assert.equal(target.vert_rate, null);
  tracker.clear();
  tracker.ingest(withFields(VELOCITY, [[47, 56, 1], [58, 67, 1]]), 1000);
  target = aircraft(tracker);
  assert.equal(target.gs, 0);
  assert.equal(target.track, null);
  tracker.clear();
  tracker.ingest(withFields(AIRSPEED, [[46, 46, 0], [58, 67, 0]]), 1000);
  target = aircraft(tracker);
  assert.equal(target.ias, null);
  assert.equal(target.mag_heading, null);
});

test('supersonic velocity subtypes apply four-knot resolution and keep TAS separate', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(withFields(VELOCITY, [[38, 40, 2], [46, 46, 0], [47, 56, 4], [57, 57, 0], [58, 67, 5]]), 1000);
  assert.equal(aircraft(tracker).gs, 20);
  near(aircraft(tracker).track, 36.86989764584402);
  tracker.clear();
  tracker.ingest(withFields(AIRSPEED, [[38, 40, 4], [57, 57, 1], [58, 67, 5]]), 1000);
  assert.equal(aircraft(tracker).tas, 16);
  assert.equal(aircraft(tracker).gs, null);
});

test('surface frames decode motion without inventing a position absent a reference station', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(SURFACE_EVEN, 1000);
  tracker.ingest(SURFACE_ODD, 2000);
  const target = aircraft(tracker, 2000);
  assert.equal(target.alt_baro, 'ground');
  assert.equal(target.gs, 16);
  assert.equal(target.track, 98.4375);
  assert.equal(target.lat, null);
  assert.equal(target.lon, null);
});

test('surface messages clear old airborne coordinates and old CPR pairs', () => {
  const tracker = new AdsbTracker();
  tracker.ingest(ODD, 1000);
  tracker.ingest(EVEN, 2000);
  assert.notEqual(aircraft(tracker, 2000).lat, null);
  tracker.ingest(withFields(SURFACE_EVEN, [[9, 32, 0x40621d]]), 3000);
  assert.equal(aircraft(tracker, 3000).lat, null);
  assert.equal(aircraft(tracker, 3000).seen_pos, null);
  tracker.ingest(EVEN, 4000);
  assert.equal(aircraft(tracker, 4000).lat, null);
});

test('surface movement boundary codes and unavailable track have honest values', () => {
  for (const [code, speed] of [[0, null], [1, 0], [2, 0.125], [8, 0.875], [9, 1], [12, 1.75], [13, 2], [38, 14.5], [39, 15], [93, 69], [94, 70], [108, 98], [109, 100], [123, 170], [124, null], [125, null], [127, null]]) {
    const tracker = new AdsbTracker();
    tracker.ingest(withFields(SURFACE_EVEN, [[38, 44, code], [45, 45, 0]]), 1000);
    assert.equal(aircraft(tracker).gs, speed, `movement ${code}`);
    assert.equal(aircraft(tracker).track, null);
  }
});

test('tracker expires silent aircraft, caps memory by least recent reception, and clear resets counters', () => {
  const tracker = new AdsbTracker({ maxAircraft: 2, ttlMs: 1000 });
  const id2 = withFields(IDENT, [[9, 32, 0x40621d]]);
  const id3 = withFields(IDENT, [[9, 32, 0x485020]]);
  tracker.ingest(IDENT, 1000);
  tracker.ingest(id2, 1100);
  tracker.ingest(IDENT, 1200);
  tracker.ingest(id3, 1300);
  assert.deepEqual(tracker.snapshot(1300).aircraft.map(row => row.hex).sort(), ['406b90', '485020']);
  assert.equal(tracker.snapshot(2200).aircraft.length, 2);
  assert.equal(tracker.snapshot(2201).aircraft.length, 1);
  assert.equal(tracker.snapshot(2301).aircraft.length, 0);
  assert.equal(tracker.snapshot(2301).messages, 4);
  tracker.clear();
  assert.deepEqual(tracker.snapshot(2301), { now: 2.301, messages: 0, aircraft: [] });
});
