import { mount } from '@vue/test-utils'
import Airspace from '@/views/airspace/index'
import AircraftDetail from '@/components/Airspace/AircraftDetail'

// Cesium owns WebGL and camera effects; keep the workbench and its state real.
const mapStub = {
  template: '<div />',
  props: ['aircraft', 'selectedId', 'labels', 'tracks', 'coverage', 'basemap', 'receiverVisible', 'receiver'],
  methods: { follow() {}, focus() {}, zoom() {}, reset() {}, setMode() {} }
}
const flush = async() => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const source = { name: '屋顶 ADS-B', host: '192.168.10.8', port: 30002, enabled: true, station: { name: '上海站', latitude: 31.23, longitude: 121.47 }}
const sourcePackage = (overrides = {}) => ({ source: { ...source }, persisted: true, status: { state: 'connecting', connected: false, message: '连接中', lastMessageAt: null }, ...overrides })
const frame = (status = { state: 'connected', connected: true, message: '接收中', lastMessageAt: new Date().toISOString() }) => ({ type: 'adsb.snapshot', data: { snapshot: { now: Date.now() / 1000, messages: 6, aircraft: [{ hex: 'abcdef', flight: 'LIVE123', lat: 31, lon: 121, alt_baro: 15000, seen: 0, seen_pos: 0 }] }, status }})
class TestSocket {
  constructor(url) { this.url = url; this.readyState = 0; TestSocket.instances.push(this) }
  open() { this.readyState = 1; if (this.onopen) this.onopen({}) }
  message(payload) { if (this.onmessage) this.onmessage({ data: JSON.stringify(payload) }) }
  close() { this.readyState = 3; if (this.onclose) this.onclose({}) }
}
TestSocket.instances = []

describe('airspace workbench', () => {
  let wrapper
  const originalFetch = global.fetch
  const originalAbortController = global.AbortController
  const originalWebSocket = global.WebSocket
  beforeEach(() => {
    jest.useFakeTimers()
    localStorage.clear()
    if (!global.AbortController) {
      global.AbortController = class {
        constructor() { this.signal = {} }
        abort() { this.signal.aborted = true }
      }
    }
    TestSocket.instances = []
    global.WebSocket = TestSocket
    global.fetch = jest.fn(async(url, options) => {
      let data = {}
      if (url.endsWith('/adsb/source')) {
        if (options.method === 'PUT') {
          const saved = JSON.parse(options.body)
          data = sourcePackage({ source: saved, ...(!saved.enabled ? { status: { state: 'disabled', connected: false, message: '停用', lastMessageAt: null }} : {}) })
        } else data = sourcePackage({ persisted: false, source: { ...source, host: '', enabled: false, station: { name: '', latitude: null, longitude: null }}, status: { state: 'unconfigured', connected: false, message: '未配置', lastMessageAt: null }})
      }
      if (url.endsWith('/modules')) data = []
      if (url.endsWith('/database/status')) data = { status: 'available' }
      return { ok: true, status: 200, json: async() => ({ ok: true, data }) }
    })
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
  })
  async function receiveAircraft() {
    await flush()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message(frame())
    await wrapper.vm.$nextTick()
  }
  afterEach(() => {
    wrapper.destroy()
    jest.clearAllTimers()
    jest.useRealTimers()
    global.fetch = originalFetch
    global.AbortController = originalAbortController
    global.WebSocket = originalWebSocket
    jest.restoreAllMocks()
  })

  it('starts with no aircraft, no invented station and no demo selector', async() => {
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.lastUpdateText).toBe('—')
    expect(wrapper.vm.referencePositionAvailable).toBe(false)
    await flush()
    await wrapper.setData({ activeMenu: 'source' })
    expect(wrapper.text()).not.toMatch(/演示|模拟航空器/)
    expect(wrapper.find('.source-choice').exists()).toBe(false)
    expect(wrapper.find(mapStub).props('receiverVisible')).toBe(false)
  })

  it('keeps an empty real-data workspace when loading the source fails', async() => {
    wrapper.destroy()
    const fetcher = global.fetch
    global.fetch = jest.fn((url, options) => url.endsWith('/adsb/source') ? Promise.reject(new Error('数据库暂不可用')) : fetcher(url, options))
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
    await flush()
    jest.advanceTimersByTime(2000)
    await flush()
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.trails).toEqual({})
    expect(wrapper.vm.sourceLoadState).toBe('unread')
    expect(wrapper.vm.lastUpdateText).toBe('—')
    expect(wrapper.text()).not.toContain('演示')
  })

  it('opens aircraft details from the list and searches by callsign', async() => {
    await receiveAircraft()
    wrapper.find('.aircraft-row').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find(AircraftDetail).props('aircraft').icao).toBe('ABCDEF')
    wrapper.find('.search-field input').setValue('LIVE123')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.aircraft-row').length).toBe(1)
    expect(wrapper.find('.aircraft-row').text()).toContain('LIVE123')
  })

  it('uses the environment default basemap in the workbench and map props', async() => {
    const previous = process.env.VUE_APP_MAP_DEFAULT_LAYER
    process.env.VUE_APP_MAP_DEFAULT_LAYER = 'dark'
    try {
      wrapper.destroy()
      wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.basemap).toBe('dark')
      expect(wrapper.find(mapStub).props('basemap')).toBe('dark')
      expect(wrapper.vm.basemapStatus.label).toBe('CARTO 深色地图')
    } finally {
      if (previous === undefined) delete process.env.VUE_APP_MAP_DEFAULT_LAYER
      else process.env.VUE_APP_MAP_DEFAULT_LAYER = previous
    }
  })

  it('stops following when the operator zooms manually', async() => {
    await receiveAircraft()
    wrapper.find('.aircraft-row').trigger('click')
    await wrapper.vm.$nextTick()
    wrapper.find('.detail-actions .primary-button').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.detail-actions .primary-button').text()).toContain('停止跟随')
    wrapper.find('[aria-label="放大地图"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.detail-actions .primary-button').text()).toContain('跟随目标')
  })

  it('separates signal domains and restores the ADS-B list when returning', async() => {
    await receiveAircraft()
    wrapper.find('.aircraft-row').trigger('click')
    await wrapper.vm.$nextTick()
    wrapper.find('.detail-actions .primary-button').trigger('click')
    await wrapper.vm.$nextTick()
    const domains = wrapper.findAll('.domain-navigation button')
    expect(domains.length).toBe(5)
    domains.at(1).trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.module-panel').text()).toContain('AIS')
    expect(wrapper.find('.module-panel').text()).toContain('未接入')
    expect(wrapper.findAll('.aircraft-row').length).toBe(0)
    expect(wrapper.find(AircraftDetail).exists()).toBe(false)
    expect(wrapper.find(mapStub).props('aircraft')).toEqual([])
    expect(wrapper.vm.following).toBe(false)
    domains.at(0).trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.aircraft-row').length).toBe(1)
    expect(wrapper.find(mapStub).props('aircraft').length).toBe(1)
    expect(wrapper.find('.module-panel').exists()).toBe(false)
  })

  it('uses the effective basemap reported by the map in the layer information', async() => {
    await wrapper.setData({ activeMenu: 'layers' })
    const select = wrapper.find('[aria-label="选择地图底图"]')
    select.setValue('google-satellite')
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.basemap).toBe('google-satellite')
    wrapper.find(mapStub).vm.$emit('basemap-change', { id: 'esri-satellite', label: 'Esri 卫星影像', fallback: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.basemap-status').text()).toContain('Esri 卫星影像')
    expect(wrapper.find('.basemap-status').text()).toContain('回退')
  })

  it('loads persisted TCP settings from the database and subscribes automatically', async() => {
    wrapper.destroy()
    const fetcher = global.fetch
    global.fetch = jest.fn((url, options) => url.endsWith('/adsb/source') ? Promise.resolve({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage() }) }) : fetcher(url, options))
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
    await flush()
    expect(wrapper.vm.sourceHost).toBe('192.168.10.8')
    expect(wrapper.vm.sourcePort).toBe(30002)
    expect(wrapper.vm.aircraft).toEqual([])
    const socket = TestSocket.instances[0]
    socket.open()
    await flush()
    expect(wrapper.vm.socketState.connected).toBe(true)
    expect(wrapper.vm.dataState).not.toBe('live')
    socket.message(frame())
    await flush()
    expect(wrapper.vm.aircraft[0].icao).toBe('ABCDEF')
    expect(wrapper.vm.dataState).toBe('live')
    expect(wrapper.find('.mode-badge').text()).toContain('实时数据')
    expect(global.fetch.mock.calls.some(([url]) => /snapshot|aircraft\.json/.test(url))).toBe(false)
  })

  it('saves TCP settings before changing the current feed', async() => {
    await flush()
    let resolveSave
    global.fetch = jest.fn(() => new Promise(resolve => { resolveSave = resolve }))
    await wrapper.setData({ sourceHost: 'receiver.local', sourcePort: 30002, sourceEnabled: true })
    const save = wrapper.vm.applySource()
    expect(wrapper.vm.aircraft).toEqual([])
    expect(TestSocket.instances).toHaveLength(1)
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/v1/adsb/source')
    expect(options.method).toBe('PUT')
    const saved = JSON.parse(options.body)
    expect(saved).toMatchObject({ host: 'receiver.local', port: 30002, enabled: true, station: { latitude: null, longitude: null }})
    resolveSave({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage({ source: saved }) }) })
    await save
    expect(wrapper.vm.aircraft).toEqual([])
    expect(TestSocket.instances).toHaveLength(1)
    expect(wrapper.vm.sourcePersisted).toBe(true)
    expect(localStorage.getItem('airspace-config')).toBe(null)
  })

  it('keeps the active socket and targets when a database save fails', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message(frame())
    global.fetch = jest.fn(async() => ({ ok: false, status: 503, json: async() => ({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: '数据库不可用' }}) }))
    await wrapper.setData({ sourceHost: 'new-receiver.local' })
    await wrapper.vm.applySource()
    expect(wrapper.vm.aircraft[0].icao).toBe('ABCDEF')
    expect(socket.readyState).toBe(1)
    expect(TestSocket.instances).toHaveLength(1)
    expect(wrapper.vm.sourceError).toContain('数据库不可用')
    expect(wrapper.vm.toastMessage).not.toContain('已保存')
  })

  it('keeps the active feed when the saved response has an invalid receiver status', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message(frame())
    global.fetch = jest.fn(async() => ({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage({ status: null }) }) }))
    await wrapper.vm.applySource()
    expect(wrapper.vm.aircraft[0].icao).toBe('ABCDEF')
    expect(socket.readyState).toBe(1)
    expect(wrapper.vm.sourceError).toContain('保存失败')
  })

  it('reports unread settings when the database cannot be read', async() => {
    wrapper.destroy()
    const fetcher = global.fetch
    global.fetch = jest.fn((url, options) => url.endsWith('/adsb/source') ? Promise.resolve({ ok: false, status: 503, json: async() => ({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: '数据库不可用' }}) }) : fetcher(url, options))
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
    await flush()
    await wrapper.setData({ activeMenu: 'source' })
    expect(wrapper.find('.source-config-status').text()).toContain('未读取')
    expect(wrapper.find('.source-config-status').text()).not.toContain('已保存')
    expect(wrapper.vm.sourcePersisted).toBe(false)
    expect(TestSocket.instances).toHaveLength(0)
  })

  it('keeps the subscription available after successfully saving a disabled source', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message(frame())
    await wrapper.setData({ sourceEnabled: false })
    await wrapper.vm.applySource()
    expect(wrapper.vm.dataState).toBe('disabled')
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.trails).toEqual({})
    expect(socket.readyState).toBe(1)
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('updates the active source and station from another page while protecting edited form fields', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    const current = frame()
    Object.assign(current.data, { source, persisted: true, revision: 1 })
    socket.message(current)
    await wrapper.setData({ activeMenu: 'source', sourceHost: 'draft.local', receiverDraft: { name: '编辑中的站点', lat: 25, lon: 110 }})
    const replacement = { ...source, host: 'other-page.local', port: 31002, station: { name: '北京站', latitude: 40, longitude: 116 }}
    const changed = frame()
    Object.assign(changed.data, { source: replacement, persisted: true, revision: 2 })
    socket.message(changed)
    await flush()
    expect(wrapper.vm.activeSource.host).toBe('other-page.local')
    expect(wrapper.vm.receiver).toEqual({ name: '北京站', lat: 40, lon: 116 })
    expect(wrapper.find(mapStub).props('receiver')).toEqual({ name: '北京站', lat: 40, lon: 116 })
    expect(wrapper.vm.sourceHost).toBe('draft.local')
    expect(wrapper.vm.receiverDraft).toEqual({ name: '编辑中的站点', lat: 25, lon: 110 })
    expect(wrapper.find('.source-config-change').text()).toContain('草稿')
    expect(wrapper.find('.connection-states').text()).toContain('other-page.local:31002')
    socket.message(changed)
    expect(wrapper.vm.sourceHost).toBe('draft.local')
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('receives a source enabled by another page while this page was disabled', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host, sourceEnabled: false })
    await wrapper.vm.applySource()
    expect(TestSocket.instances).toHaveLength(1)
    const socket = TestSocket.instances[0]
    socket.open()
    const disabled = frame({ state: 'disabled', connected: false, message: 'disabled', lastMessageAt: null })
    Object.assign(disabled.data, { source: { ...source, enabled: false }, persisted: true, revision: 1 })
    socket.message(disabled)
    const enabled = frame()
    Object.assign(enabled.data, { source, persisted: true, revision: 2 })
    socket.message(enabled)
    expect(wrapper.vm.dataState).toBe('live')
    expect(wrapper.vm.activeSource.enabled).toBe(true)
    expect(wrapper.vm.aircraft[0].icao).toBe('ABCDEF')
    expect(wrapper.vm.sourceEnabled).toBe(false)
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('keeps the saved disabled TCP state while opening its update subscription', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host, sourceEnabled: false })
    await wrapper.vm.applySource()
    expect(wrapper.vm.dataState).toBe('disabled')
    expect(wrapper.vm.socketState.state).toBe('connecting')
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('accepts a lower source revision after reconnecting to a restarted backend', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const first = TestSocket.instances[0]
    first.open()
    const initial = frame()
    Object.assign(initial.data, { source, persisted: true, revision: 12 })
    first.message(initial)
    first.close()
    jest.advanceTimersByTime(1000)
    const reconnected = TestSocket.instances[1]
    reconnected.open()
    const restarted = frame()
    Object.assign(restarted.data, { source: { ...source, host: 'restarted.local', station: { name: '杭州站', latitude: 30, longitude: 120 }}, persisted: true, revision: 1 })
    reconnected.message(restarted)
    expect(wrapper.vm.sourceRevision).toBe(1)
    expect(wrapper.vm.activeSource.host).toBe('restarted.local')
    expect(wrapper.vm.receiver).toEqual({ name: '杭州站', lat: 30, lon: 120 })
    expect(wrapper.vm.aircraft[0].icao).toBe('ABCDEF')
  })

  it('does not accept an older queued source packet after a successful local save', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    const older = frame()
    Object.assign(older.data, { source, persisted: true, revision: 2 })
    socket.message(older)
    global.fetch = jest.fn(async(url, options) => ({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage({ source: JSON.parse(options.body), revision: 3 }) }) }))
    await wrapper.setData({ sourceHost: 'saved.local' })
    await wrapper.vm.applySource()
    socket.message(older)
    expect(wrapper.vm.sourceRevision).toBe(3)
    expect(wrapper.vm.activeSource.host).toBe('saved.local')
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('hides a removed remote station and ignores packets from the older source revision', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    const current = frame()
    Object.assign(current.data, { source, persisted: true, revision: 1 })
    socket.message(current)
    const removed = frame({ state: 'disabled', connected: false, message: 'disabled', lastMessageAt: null })
    Object.assign(removed.data, { source: { ...source, enabled: false, station: { name: '', latitude: null, longitude: null }}, persisted: true, revision: 2 })
    socket.message(removed)
    socket.message(current)
    await flush()
    expect(wrapper.vm.referencePositionAvailable).toBe(false)
    expect(wrapper.find(mapStub).props('receiverVisible')).toBe(false)
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.dataState).toBe('disabled')
    expect(wrapper.vm.sourceRevision).toBe(2)
  })

  it('retries an unread initial database configuration and activates it after recovery', async() => {
    wrapper.destroy()
    const fetcher = global.fetch
    let reads = 0
    global.fetch = jest.fn((url, options) => {
      if (!url.endsWith('/adsb/source')) return fetcher(url, options)
      reads++
      return Promise.resolve(reads === 1 ? { ok: false, status: 503, json: async() => ({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂不可用' }}) } : { ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage() }) })
    })
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
    await flush()
    expect(wrapper.vm.sourceLoadState).toBe('unread')
    jest.advanceTimersByTime(999)
    await flush()
    expect(reads).toBe(1)
    jest.advanceTimersByTime(1)
    await flush()
    expect(reads).toBe(2)
    expect(wrapper.vm.sourceHost).toBe(source.host)
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('bounds configuration retries at thirty seconds', async() => {
    wrapper.destroy()
    const fetcher = global.fetch
    let reads = 0
    global.fetch = jest.fn((url, options) => {
      if (!url.endsWith('/adsb/source')) return fetcher(url, options)
      reads++
      return Promise.resolve({ ok: false, status: 503, json: async() => ({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂不可用' }}) })
    })
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
    await flush()
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = reads
      jest.advanceTimersByTime(delay - 1)
      await flush()
      expect(reads).toBe(before)
      jest.advanceTimersByTime(1)
      await flush()
      expect(reads).toBe(before + 1)
    }
    expect(wrapper.vm.aircraft).toEqual([])
  })

  it.each(['save', 'destroy'])('cancels an unread initial configuration retry after %s', async(action) => {
    wrapper.destroy()
    const fetcher = global.fetch
    let reads = 0
    global.fetch = jest.fn((url, options) => {
      if (!url.endsWith('/adsb/source')) return fetcher(url, options)
      if (options.method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage({ source: JSON.parse(options.body) }) }) })
      reads++
      return Promise.resolve({ ok: false, status: 503, json: async() => ({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂不可用' }}) })
    })
    wrapper = mount(Airspace, { stubs: { CesiumMap: mapStub }})
    await flush()
    if (action === 'save') {
      await wrapper.setData({ sourceHost: source.host })
      await wrapper.vm.applySource()
    } else wrapper.destroy()
    const before = reads
    jest.advanceTimersByTime(30000)
    await flush()
    expect(reads).toBe(before)
  })

  it.each(['reconnecting', 'disabled', 'unconfigured'])('clears targets when the TCP source is %s despite an open WebSocket', async(state) => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message(frame())
    await wrapper.vm.$nextTick()
    wrapper.vm.selectAircraft('ABCDEF')
    socket.message(frame({ state, connected: false, message: 'TCP unavailable', lastMessageAt: null }))
    await flush()
    expect(wrapper.vm.socketState.connected).toBe(true)
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.trails).toEqual({})
    expect(wrapper.vm.selectedId).toBe('')
    expect(wrapper.vm.dataState).toBe(state)
  })

  it('clears targets on a broken socket while retaining live mode', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message(frame())
    socket.close()
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.trails).toEqual({})
    expect(wrapper.vm.socketState.connected).toBe(false)
    jest.advanceTimersByTime(1000)
    expect(TestSocket.instances).toHaveLength(2)
  })

  it('does not connect when receiver coordinates are empty', async() => {
    await flush()
    global.fetch = jest.fn()
    await wrapper.setData({ receiverDraft: { name: '测试站', lat: '', lon: 121 }})
    await wrapper.vm.applySource()
    expect(wrapper.vm.sourceError).toContain('经纬度')
  })

  it('saves empty live station coordinates as null and hides station entities', async() => {
    await flush()
    expect(wrapper.vm.receiverDraft.lat).toBe('')
    expect(wrapper.vm.receiverDraft.lon).toBe('')
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    await wrapper.vm.$nextTick()
    const save = global.fetch.mock.calls.find(([url, options]) => url.endsWith('/adsb/source') && options.method === 'PUT')
    expect(JSON.parse(save[1].body).station).toMatchObject({ latitude: null, longitude: null })
    expect(wrapper.find(mapStub).props('receiverVisible')).toBe(false)
    expect(wrapper.find(mapStub).props('coverage')).toBe(false)
    await wrapper.setData({ activeMenu: 'station' })
    expect(wrapper.find('.subtle-tag').text()).toContain('未设置参考位置')
  })

  it('distinguishes a waiting TCP connection from received aircraft data', async() => {
    await flush()
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    const socket = TestSocket.instances[0]
    socket.open()
    const waiting = frame({ state: 'waiting', connected: true, message: '等待有效帧', lastMessageAt: null })
    waiting.data.snapshot.aircraft = []
    socket.message(waiting)
    await wrapper.setData({ activeMenu: 'source' })
    expect(wrapper.vm.dataState).toBe('waiting')
    expect(wrapper.vm.sourceStatus.connected).toBe(true)
    expect(wrapper.find('.connection-states').text()).toContain('等待有效消息')
    expect(wrapper.find('.connection-states').text()).not.toContain('接收中')
  })

  it('does not turn a successful but unpersisted save response into live data', async() => {
    await flush()
    global.fetch = jest.fn(async() => ({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage({ persisted: false }) }) }))
    await wrapper.setData({ sourceHost: source.host })
    await wrapper.vm.applySource()
    expect(wrapper.vm.aircraft).toEqual([])
    expect(wrapper.vm.sourceError).toContain('未保存')
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('ignores a successful save after the component is destroyed', async() => {
    await flush()
    let finishSave
    global.fetch = jest.fn(() => new Promise(resolve => { finishSave = resolve }))
    await wrapper.setData({ sourceHost: source.host })
    const save = wrapper.vm.applySource()
    wrapper.destroy()
    finishSave({ ok: true, status: 200, json: async() => ({ ok: true, data: sourcePackage() }) })
    await save
    expect(TestSocket.instances).toHaveLength(1)
  })

  it.each([['http://receiver.local', 30002], ['receiver.local', 0], ['receiver.local', 65536], ['receiver.local', 30002.5]])('does not save an invalid TCP address %s:%s', async(host, port) => {
    await flush()
    await wrapper.setData({ sourceHost: host, sourcePort: port })
    await wrapper.vm.applySource()
    expect(wrapper.vm.sourceError).toBeTruthy()
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('opens the configuration sidebar from top navigation after it was collapsed', async() => {
    wrapper.find('[aria-label="收起侧栏"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('sidebar-collapsed')
    wrapper.findAll('.top-navigation button').at(1).trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('sidebar-collapsed')
    expect(wrapper.find('.source-content').exists()).toBe(true)
  })

  it('closes help and details with Escape', async() => {
    await receiveAircraft()
    wrapper.find('.aircraft-row').trigger('click')
    wrapper.find('[aria-label="使用说明"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('.aircraft-detail').exists()).toBe(false)
  })
})
