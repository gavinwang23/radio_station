import { createImageryRegistry, probeImagery } from '@/services/map/imagery-registry'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function event() {
  const listeners = new Set()
  return {
    addEventListener(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    raise() { [...listeners].forEach(listener => listener()) },
    get size() { return listeners.size }
  }
}

function setup() {
  const credits = new Set()
  const moveEnd = event()
  let rectangle = { north: 90, south: -90, west: 120, east: 124 }
  const C = {
    Math: { toDegrees: value => value },
    Cartographic: { fromDegrees: (longitude, latitude) => ({ longitude, latitude }) },
    Credit: class { constructor(html, showOnScreen) { this.html = html; this.showOnScreen = showOnScreen } },
    UrlTemplateImageryProvider: class { constructor(options) { Object.assign(this, options) } }
  }
  const viewer = {
    creditDisplay: { addStaticCredit: credit => credits.add(credit), removeStaticCredit: credit => credits.delete(credit) },
    camera: { computeViewRectangle: () => rectangle, moveEnd },
    scene: {
      globe: { ellipsoid: {}}, canvas: { clientWidth: 1024 }, requestRender() {}
    }
  }
  return { C, viewer, credits, moveEnd, setRectangle: value => { rectangle = value } }
}

const response = copyright => ({ ok: true, json: async() => ({ ok: true, data: { copyright }}) })
const flush = async() => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('Google Maps viewport attribution', () => {
  it('uses actual camera bounds, escapes API attribution, and removes camera listeners and credits on disposal', async() => {
    const state = setup()
    const requests = []
    const layer = await createImageryRegistry().get('google-satellite').create({
      ...state,
      fetch: async url => { requests.push(url); return response('Map data © A <img> & B') }
    })
    expect(requests[0]).toContain('north=89.9999&south=-89.9999&east=124&west=120')
    expect(requests[0]).toContain('zoom=8')
    expect(state.credits.size).toBe(0)
    layer.attach()
    expect([...state.credits][0].html).toBe('Map data © A &lt;img&gt; &amp; B')
    expect([...state.credits][0].showOnScreen).toBe(true)
    state.setRectangle({ north: 32, south: 30, east: 122, west: 121 })
    state.moveEnd.raise()
    await flush()
    expect(requests[1]).toContain('north=32&south=30&east=122&west=121')
    expect(state.credits.size).toBe(1)
    layer.dispose()
    expect(state.moveEnd.size).toBe(0)
    expect(state.credits.size).toBe(0)
  })

  it('ignores a failed older viewport request after the latest camera request succeeds', async() => {
    const state = setup()
    const old = deferred()
    const recent = deferred()
    const pending = [Promise.resolve(response('initial')), old.promise, recent.promise]
    const failures = []
    const layer = await createImageryRegistry().get('google-satellite').create({
      ...state, fetch: () => pending.shift(), onFatalError: error => failures.push(error)
    })
    layer.attach()
    state.moveEnd.raise()
    state.moveEnd.raise()
    recent.resolve(response('current copyright'))
    await flush()
    old.reject(new Error('old network failure'))
    await flush()
    expect(failures).toHaveLength(0)
    expect([...state.credits][0].html).toBe('current copyright')
    layer.dispose()
  })

  it('rejects an unavailable proxy before Google tiles are activated', async() => {
    const state = setup()
    await expect(createImageryRegistry().get('google-satellite').create({
      ...state, fetch: async() => ({ ok: false, status: 503 })
    })).rejects.toThrow('HTTP 503')
    expect(state.credits.size).toBe(0)
    expect(state.moveEnd.size).toBe(0)
  })

  it('does not reinsert attribution when a response arrives after disposal', async() => {
    const state = setup()
    const late = deferred()
    const pending = [Promise.resolve(response('initial')), late.promise]
    const layer = await createImageryRegistry().get('google-satellite').create({ ...state, fetch: () => pending.shift() })
    layer.attach()
    state.moveEnd.raise()
    layer.dispose()
    late.resolve(response('late copyright'))
    await flush()
    expect(state.credits.size).toBe(0)
  })
})

describe('imagery tile readiness', () => {
  it('probes the visible antimeridian tile rather than an arbitrary world tile', async() => {
    const state = setup()
    state.setRectangle({ north: 20, south: 10, west: 178, east: -178 })
    const tiles = []
    const provider = {
      maximumLevel: 6,
      tilingScheme: { positionToTileXY: (position, level) => { tiles.push({ position, level }); return { x: 63, y: 29 } } },
      requestImage: async(x, y, level) => ({ x, y, level })
    }
    expect(await probeImagery(provider, state)).toEqual({ x: 63, y: 29, level: 6 })
    expect(tiles).toEqual([{ position: { longitude: -180, latitude: 15 }, level: 6 }])
  })
})
