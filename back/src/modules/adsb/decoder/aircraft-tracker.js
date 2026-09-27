/**
 * A deliberately bounded ADS-B subset, with no parity correction or ICAO
 * inference for address/parity Mode S replies. Algorithms and golden fixtures:
 * https://mode-s.org/1090mhz/content/ads-b/3-airborne-position.html
 * https://mode-s.org/1090mhz/content/ads-b/5-airborne-velocity.html
 * DF18 address semantics: flightaware/dump1090 mode_s.c decodeExtendedSquitter.
 */
export class AdsbTracker {
  #aircraft = new Map();
  #messages = 0;
  #maxAircraft;
  #ttlMs;
  #nextPrune = -Infinity;

  constructor({ maxAircraft = 3000, ttlMs = 60000 } = {}) {
    if (!Number.isSafeInteger(maxAircraft) || maxAircraft < 1) throw new RangeError('maxAircraft must be a positive integer');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('ttlMs must be positive');
    this.#maxAircraft = maxAircraft;
    this.#ttlMs = ttlMs;
  }

  /** Returns true for supported, CRC-valid ICAO ADS-B frames; false otherwise. */
  ingest(hex, now = Date.now()) {
    if (typeof hex !== 'string' || !/^[0-9a-f]{28}$/i.test(hex) || !Number.isFinite(now)) return false;
    const bytes = Buffer.from(hex, 'hex');
    const df = bytes[0] >>> 3;
    // CF0 is the only supported DF18 format whose address is unconditionally
    // ICAO. TIS-B/ADS-R need type-dependent IMF handling and are excluded.
    if ((df !== 17 && df !== 18) || (df === 18 && (bytes[0] & 7) !== 0) || crcRemainder(bytes) !== 0) return false;
    const address = hex.slice(2, 8).toLowerCase();
    if (address === '000000' || address === 'ffffff') return false;
    const typeCode = getBits(bytes, 33, 37);
    if (!((typeCode >= 1 && typeCode <= 18) || (typeCode >= 20 && typeCode <= 22) ||
      (typeCode === 19 && getBits(bytes, 38, 40) >= 1 && getBits(bytes, 38, 40) <= 4))) return false;

    // Pruning at most once per second keeps frame ingestion linear in messages
    // rather than multiplying every frame by the configured aircraft capacity.
    if (now >= this.#nextPrune) {
      this.#prune(now);
      this.#nextPrune = now + Math.min(this.#ttlMs, 1000);
    }
    let target = this.#aircraft.get(address);
    if (target && now - target.lastSeen > this.#ttlMs) {
      this.#aircraft.delete(address);
      target = null;
    }
    if (!target) {
      if (this.#aircraft.size >= this.#maxAircraft) this.#aircraft.delete(this.#aircraft.keys().next().value);
      target = newAircraft(address, now);
    }
    // Ignore old injected reception times rather than overwriting newer state.
    if (now < target.lastSeen) return false;
    target.lastSeen = now;
    target.data.messages++;
    this.#messages++;
    if (typeCode <= 4) decodeIdentification(bytes, typeCode, target.data);
    else if (typeCode <= 8) decodeSurface(bytes, target);
    else if (typeCode === 19) decodeVelocity(bytes, target.data);
    else decodeAirbornePosition(bytes, typeCode, target, now);
    // Refresh insertion order for bounded least-recently-received eviction.
    this.#aircraft.delete(address);
    this.#aircraft.set(address, target);
    return true;
  }

  snapshot(now = Date.now()) {
    if (!Number.isFinite(now)) throw new TypeError('snapshot time must be finite');
    this.#prune(now);
    return {
      now: now / 1000,
      messages: this.#messages,
      aircraft: [...this.#aircraft.values()].map(target => ({
        ...target.data,
        seen: Math.max(0, now - target.lastSeen) / 1000,
        seen_pos: target.positionTime === null ? null : Math.max(0, now - target.positionTime) / 1000,
      })),
    };
  }

  clear() {
    this.#aircraft.clear();
    this.#messages = 0;
    this.#nextPrune = -Infinity;
  }

  #prune(now) {
    for (const [address, target] of this.#aircraft) {
      if (now - target.lastSeen > this.#ttlMs) this.#aircraft.delete(address);
    }
  }
}

function newAircraft(hex, now) {
  return {
    lastSeen: now, positionTime: null, cprEven: null, cprOdd: null,
    data: { hex, flight: null, alt_baro: null, alt_geom: null, gs: null, track: null,
      baro_rate: null, geom_rate: null, vert_rate: null, ias: null, tas: null,
      mag_heading: null, lat: null, lon: null, messages: 0 },
  };
}

function crcRemainder(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit--) {
      const top = crc >>> 23;
      crc = ((crc << 1) | ((byte >>> bit) & 1)) & 0xffffff;
      if (top) crc ^= 0xfff409;
    }
  }
  return crc;
}

// All decoded fields fit within 17 bits, avoiding JS signed 32-bit shifts.
function getBits(bytes, start, end) {
  let value = 0;
  for (let bit = start - 1; bit < end; bit++) value = value * 2 + ((bytes[bit >>> 3] >>> (7 - (bit & 7))) & 1);
  return value;
}

function decodeIdentification(bytes, typeCode, data) {
  let flight = '';
  for (let start = 41; start <= 83; start += 6) {
    const code = getBits(bytes, start, start + 5);
    if (code >= 1 && code <= 26) flight += String.fromCharCode(64 + code);
    else if (code === 32) flight += ' ';
    else if (code >= 48 && code <= 57) flight += String.fromCharCode(code);
    else { flight = null; break; }
  }
  data.flight = flight && flight.trim() ? flight : null;
  data.category = `${(14 - typeCode).toString(16)}${getBits(bytes, 38, 40)}`.toUpperCase();
}

function decodeSurface(bytes, target) {
  const data = target.data;
  data.alt_baro = 'ground';
  data.alt_geom = null;
  data.lat = data.lon = null;
  data.baro_rate = data.geom_rate = data.vert_rate = null;
  data.mag_heading = data.ias = data.tas = null;
  target.positionTime = target.cprEven = target.cprOdd = null;
  data.gs = surfaceSpeed(getBits(bytes, 38, 44));
  data.track = getBits(bytes, 45, 45) ? getBits(bytes, 46, 52) * 360 / 128 : null;
}

function surfaceSpeed(code) {
  if (code === 1) return 0;
  if (code >= 2 && code <= 8) return (code - 1) * 0.125;
  if (code >= 9 && code <= 12) return 1 + (code - 9) * 0.25;
  if (code >= 13 && code <= 38) return 2 + (code - 13) * 0.5;
  if (code >= 39 && code <= 93) return 15 + code - 39;
  if (code >= 94 && code <= 108) return 70 + (code - 94) * 2;
  if (code >= 109 && code <= 123) return 100 + (code - 109) * 5;
  // 124 is a lower bound (>=175kt), not an exact speed; 125-127 reserved.
  return null;
}

function decodeVelocity(bytes, data) {
  if (data.alt_baro === 'ground') data.alt_baro = null;
  const subtype = getBits(bytes, 38, 40);
  const scale = subtype === 2 || subtype === 4 ? 4 : 1;
  data.gs = data.track = data.mag_heading = data.ias = data.tas = null;
  if (subtype <= 2) {
    const eastWest = getBits(bytes, 47, 56), northSouth = getBits(bytes, 58, 67);
    if (eastWest && northSouth) {
      const vx = (eastWest - 1) * scale * (getBits(bytes, 46, 46) ? -1 : 1);
      const vy = (northSouth - 1) * scale * (getBits(bytes, 57, 57) ? -1 : 1);
      data.gs = Math.hypot(vx, vy);
      if (data.gs > 0) data.track = modulo(Math.atan2(vx, vy) * 180 / Math.PI, 360);
    }
  } else {
    if (getBits(bytes, 46, 46)) data.mag_heading = getBits(bytes, 47, 56) * 360 / 1024;
    const airspeed = getBits(bytes, 58, 67);
    if (airspeed) data[getBits(bytes, 57, 57) ? 'tas' : 'ias'] = (airspeed - 1) * scale;
  }
  const rawRate = getBits(bytes, 70, 78);
  data.baro_rate = data.geom_rate = null;
  data.vert_rate = rawRate ? (rawRate - 1) * (getBits(bytes, 69, 69) ? -64 : 64) : null;
  if (data.vert_rate !== null) data[getBits(bytes, 68, 68) ? 'baro_rate' : 'geom_rate'] = data.vert_rate;
}

function decodeAirbornePosition(bytes, typeCode, target, now) {
  const data = target.data;
  const rawAltitude = getBits(bytes, 41, 52);
  const source = typeCode >= 20 ? 'gnss' : 'baro';
  if (data.alt_baro === 'ground') data.alt_baro = null;
  if (source === 'baro') {
    // Q0 Gillham encoding is intentionally unsupported, not interpreted as Q1.
    data.alt_baro = rawAltitude & 0x10 ? (((rawAltitude & 0xfe0) >>> 1) | (rawAltitude & 0x0f)) * 25 - 1000 : null;
  } else {
    // GNSS height uses the full raw value in metres, with no Q-bit removal.
    data.alt_geom = rawAltitude ? rawAltitude / 0.3048 : null;
  }
  const odd = getBits(bytes, 54, 54);
  const frame = { lat: getBits(bytes, 55, 71) / 131072, lon: getBits(bytes, 72, 88) / 131072, now, source };
  target[odd ? 'cprOdd' : 'cprEven'] = frame;
  const even = target.cprEven, oddFrame = target.cprOdd;
  if (!even || !oddFrame || even.source !== oddFrame.source || Math.abs(even.now - oddFrame.now) > 10000) return;
  const position = globalCpr(even, oddFrame);
  if (!position) return;
  data.lat = position.lat;
  data.lon = position.lon;
  target.positionTime = Math.max(even.now, oddFrame.now);
}

function modulo(value, divisor) { return ((value % divisor) + divisor) % divisor; }

function longitudeZones(latitude) {
  const absolute = Math.abs(latitude);
  if (absolute >= 87) return absolute === 87 ? 2 : 1;
  const cosine = Math.cos(absolute * Math.PI / 180);
  const argument = 1 - (1 - Math.cos(Math.PI / 30)) / (cosine * cosine);
  return Math.floor(2 * Math.PI / Math.acos(Math.max(-1, Math.min(1, argument))));
}

function globalCpr(even, odd) {
  const j = Math.floor(59 * even.lat - 60 * odd.lat + 0.5);
  let evenLat = 6 * (modulo(j, 60) + even.lat);
  let oddLat = (360 / 59) * (modulo(j, 59) + odd.lat);
  if (evenLat >= 270) evenLat -= 360;
  if (oddLat >= 270) oddLat -= 360;
  if (Math.abs(evenLat) > 90 || Math.abs(oddLat) > 90) return null;
  const nl = longitudeZones(evenLat);
  if (nl !== longitudeZones(oddLat)) return null;
  const useOdd = odd.now > even.now;
  const ni = Math.max(nl - (useOdd ? 1 : 0), 1);
  const m = Math.floor(even.lon * (nl - 1) - odd.lon * nl + 0.5);
  let lon = (360 / ni) * (modulo(m, ni) + (useOdd ? odd.lon : even.lon));
  if (lon >= 180) lon -= 360;
  return { lat: useOdd ? oddLat : evenLat, lon };
}
