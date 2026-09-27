const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null

export function normalizeAircraft(raw, ageOffset = 0) {
  const altitude = raw.alt_baro != null ? raw.alt_baro : raw.altitude
  const latitude = number(raw.lat)
  const longitude = number(raw.lon)
  const seen = number(raw.seen) == null ? null : number(raw.seen) + ageOffset
  const positionAge = number(raw.seen_pos) == null ? seen : number(raw.seen_pos) + ageOffset
  const stale = (seen != null && seen > 15) || (positionAge != null && positionAge > 30)
  const icao = String(raw.hex || '').toUpperCase()
  return {
    icao,
    callsign: String(raw.flight || '').trim() || icao,
    latitude,
    longitude,
    hasPosition: latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !stale,
    stale,
    onGround: altitude === 'ground',
    altitude: altitude === 'ground' ? 0 : number(altitude),
    speed: number(raw.gs != null ? raw.gs : raw.speed),
    heading: number(raw.track),
    verticalRate: number(raw.baro_rate != null ? raw.baro_rate : raw.vert_rate),
    squawk: raw.squawk || null,
    rssi: number(raw.rssi),
    seen,
    positionAge,
    messages: number(raw.messages),
    category: raw.category || null,
    emergency: raw.emergency && raw.emergency !== 'none' ? raw.emergency : null,
    source: Array.isArray(raw.mlat) && raw.mlat.length ? 'MLAT' : 'ADS-B'
  }
}

export function normalizeFeed(payload, ageOffset = 0) {
  const rows = Array.isArray(payload) ? payload : payload && payload.aircraft
  if (!Array.isArray(rows)) throw new Error('响应不是有效的 aircraft.json 数据')
  const aircraft = new Map()
  rows.forEach(raw => {
    if (!raw || !/^(~)?[0-9a-f]{6}$/i.test(raw.hex || '')) return
    const target = normalizeAircraft(raw, ageOffset)
    aircraft.set(target.icao, target)
  })
  return {
    aircraft: Array.from(aircraft.values()),
    messages: number(payload.messages),
    timestamp: number(payload.now)
  }
}

export function updateTrails(previous, aircraft, limit = 90) {
  const result = {}
  aircraft.forEach(target => {
    if (!target.hasPosition) return
    const trail = (previous[target.icao] || []).slice()
    const last = trail[trail.length - 1]
    if (!last || last[0] !== target.longitude || last[1] !== target.latitude) {
      trail.push([target.longitude, target.latitude])
    }
    result[target.icao] = trail.slice(-limit)
  })
  return result
}

export function formatNumber(value, digits = 0) {
  return value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
