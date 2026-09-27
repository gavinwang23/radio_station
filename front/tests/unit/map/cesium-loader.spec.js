import { createCesiumLoader } from '@/services/map/cesium-loader'

describe('Cesium script loading', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); document.head.innerHTML = '' })

  it('shares a pending request and retries after the ten second timeout', async() => {
    const browser = {}
    const load = createCesiumLoader({ browser, document, baseUrl: '/app/' })
    const first = load()
    expect(load()).toBe(first)
    const failed = first.catch(error => error.message)
    jest.advanceTimersByTime(10000)
    expect(await failed).toContain('超时')
    expect(document.querySelector('script')).toBeNull()
    const second = load()
    browser.Cesium = { Viewer: class {} }
    document.querySelector('script').onload()
    expect(await second).toBe(browser.Cesium)
    expect(browser.CESIUM_BASE_URL).toBe('/app/cesium/')
  })

  it('rejects a script that loads without installing Cesium and permits retry', async() => {
    const load = createCesiumLoader({ browser: {}, document, baseUrl: '/' })
    const first = load().catch(error => error.message)
    document.querySelector('script').onload()
    expect(await first).toContain('Cesium')
    const second = load().catch(error => error.message)
    document.querySelector('script').onerror()
    expect(await second).toContain('加载失败')
  })
})
