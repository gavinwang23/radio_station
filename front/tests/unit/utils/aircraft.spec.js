import { normalizeAircraft, normalizeFeed, updateTrails } from '@/utils/aircraft'

describe('dump1090 data adapter', () => {
  it('normalizes legacy fields, keeps zero values and trims callsigns', () => {
    const aircraft = normalizeAircraft({ hex: 'abc123', flight: ' CCA123 ', lat: 0, lon: 0, altitude: 0, speed: 0, track: 0, seen: 0 })
    expect(aircraft.callsign).toBe('CCA123')
    expect(aircraft.icao).toBe('ABC123')
    expect(aircraft.hasPosition).toBe(true)
    expect(aircraft.altitude).toBe(0)
    expect(aircraft.speed).toBe(0)
    expect(aircraft.heading).toBe(0)
  })

  it('does not coerce unknown telemetry or invalid positions to zero', () => {
    const aircraft = normalizeAircraft({ hex: 'abc123', lat: null, lon: 121, alt_baro: null, gs: null, track: null })
    expect(aircraft.hasPosition).toBe(false)
    expect(aircraft.altitude).toBe(null)
    expect(aircraft.speed).toBe(null)
    expect(aircraft.heading).toBe(null)
    expect(normalizeAircraft({ hex: 'abc124', lat: 91, lon: 121 }).hasPosition).toBe(false)
  })

  it('keeps ground targets and marks old positions as stale', () => {
    const aircraft = normalizeAircraft({ hex: 'abc123', lat: 31, lon: 121, alt_baro: 'ground', seen: 1, seen_pos: 45 })
    expect(aircraft.onGround).toBe(true)
    expect(aircraft.altitude).toBe(0)
    expect(aircraft.hasPosition).toBe(false)
    expect(aircraft.stale).toBe(true)
  })

  it('supports legacy arrays and modern envelopes, removing duplicates and invalid IDs', () => {
    expect(normalizeFeed([{ hex: 'abc123' }]).aircraft.length).toBe(1)
    const feed = normalizeFeed({ now: 100, messages: 200, aircraft: [{ hex: 'abc123' }, { hex: 'abc123' }, { lat: 31 }] })
    expect(feed.aircraft.length).toBe(1)
    expect(feed.messages).toBe(200)
    expect(() => normalizeFeed({ error: 'invalid response' })).toThrow()
  })

  it('bounds trails and removes targets missing from the current feed', () => {
    const old = { ABC123: [[120, 30], [121, 31]], DEAD00: [[120, 30]] }
    const aircraft = normalizeAircraft({ hex: 'abc123', lat: 32, lon: 122 })
    expect(updateTrails(old, [aircraft], 2)).toEqual({ ABC123: [[121, 31], [122, 32]] })
    expect(old.ABC123.length).toBe(2)
  })

  it('ages message and position timestamps when the source snapshot stops advancing', () => {
    const aircraft = normalizeAircraft({ hex: 'abc123', lat: 31, lon: 121, seen: 0, seen_pos: 0 }, 20)
    expect(aircraft.seen).toBe(20)
    expect(aircraft.positionAge).toBe(20)
    expect(aircraft.hasPosition).toBe(false)
  })
})
