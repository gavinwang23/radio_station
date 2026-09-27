import { createCesiumLoader } from '@/services/map/cesium-loader'
import { createImageryRegistry } from '@/services/map/imagery-registry'
import { getMapConfig } from '@/services/map/map-config'

const environmentKeys = [
  'BASE_URL',
  'VUE_APP_API_BASE_URL',
  'VUE_APP_MAP_DEFAULT_LAYER',
  'VUE_APP_CESIUM_BASE_URL',
  'VUE_APP_MAP_OFFLINE_URL',
  'VUE_APP_MAP_ESRI_URL',
  'VUE_APP_MAP_CARTO_URL',
  'VUE_APP_MAP_GOOGLE_TILES_PATH',
  'VUE_APP_MAP_GOOGLE_VIEWPORT_PATH'
]

function cesium() {
  return {
    Math: { toDegrees: value => value },
    Credit: class { constructor(html) { this.html = html } },
    UrlTemplateImageryProvider: class { constructor(options) { Object.assign(this, options) } },
    TileMapServiceImageryProvider: { fromUrl: async url => ({ url }) }
  }
}

function viewer() {
  return {
    creditDisplay: {},
    camera: { computeViewRectangle: () => ({ north: 32, south: 30, east: 122, west: 121 }) },
    scene: { globe: { ellipsoid: {}}, canvas: { clientWidth: 1024 }}
  }
}

describe('environment configured map resources', () => {
  let originalEnvironment

  beforeEach(() => {
    originalEnvironment = {}
    environmentKeys.forEach(key => {
      originalEnvironment[key] = process.env[key]
      delete process.env[key]
    })
  })

  afterEach(() => {
    environmentKeys.forEach(key => {
      if (originalEnvironment[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnvironment[key]
    })
    document.head.innerHTML = ''
  })

  it('uses configured Esri and CARTO tile templates without encoding placeholders', () => {
    process.env.VUE_APP_MAP_ESRI_URL = ' https://imagery.example/esri/{z}/{y}/{x} '
    process.env.VUE_APP_MAP_CARTO_URL = ' https://imagery.example/dark/{z}/{x}/{y}.png '
    const registry = createImageryRegistry()
    const C = cesium()
    expect(registry.get('esri-satellite').create({ C }).provider.url).toBe('https://imagery.example/esri/{z}/{y}/{x}')
    expect(registry.get('dark').create({ C }).provider.url).toBe('https://imagery.example/dark/{z}/{x}/{y}.png')
  })

  it('joins Google proxy paths to the configured API base for tiles and viewport attribution', async() => {
    process.env.VUE_APP_API_BASE_URL = 'https://backend.example/api/v2/'
    process.env.VUE_APP_MAP_GOOGLE_TILES_PATH = ' imagery/google/{z}/{x}/{y} '
    process.env.VUE_APP_MAP_GOOGLE_VIEWPORT_PATH = ' imagery/google/viewport '
    const requests = []
    const layer = await createImageryRegistry().get('google-satellite').create({
      C: cesium(), viewer: viewer(),
      fetch: async url => {
        requests.push(url)
        return { ok: true, json: async() => ({ ok: true, data: { copyright: 'Map data' }}) }
      }
    })
    expect(layer.provider.url).toBe('https://backend.example/api/v2/imagery/google/{z}/{x}/{y}')
    expect(requests[0]).toBe('https://backend.example/api/v2/imagery/google/viewport?zoom=10&north=32&south=30&east=122&west=121')
    layer.dispose()
  })

  it('loads the runtime and default offline imagery from the same configured Cesium directory', async() => {
    process.env.VUE_APP_CESIUM_BASE_URL = ' https://assets.example/cesium-v1 '
    const browser = {}
    const loading = createCesiumLoader({ browser, document })()
    const script = document.querySelector('script')
    browser.Cesium = cesium()
    script.onload()
    await loading
    expect(browser.CESIUM_BASE_URL).toBe('https://assets.example/cesium-v1/')
    expect(script.getAttribute('src')).toBe('https://assets.example/cesium-v1/Cesium.js')
    const layer = await createImageryRegistry().get('offline').create({ C: browser.Cesium })
    expect(layer.provider.url).toBe('https://assets.example/cesium-v1/Assets/Textures/NaturalEarthII')
  })

  it('accepts an explicit offline imagery URL independently of the runtime directory', async() => {
    process.env.VUE_APP_CESIUM_BASE_URL = 'https://assets.example/runtime/'
    process.env.VUE_APP_MAP_OFFLINE_URL = ' https://imagery.example/natural-earth '
    const layer = await createImageryRegistry().get('offline').create({ C: cesium() })
    expect(layer.provider.url).toBe('https://imagery.example/natural-earth')
  })

  it('uses the deployment base and existing providers when map configuration is blank', async() => {
    environmentKeys.filter(key => key !== 'BASE_URL' && key !== 'VUE_APP_API_BASE_URL').forEach(key => { process.env[key] = '   ' })
    process.env.BASE_URL = '/console/'
    const C = cesium()
    const registry = createImageryRegistry()
    expect((await registry.get('offline').create({ C })).provider.url).toBe('/console/cesium/Assets/Textures/NaturalEarthII')
    expect(registry.get('esri-satellite').create({ C }).provider.url).toBe('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')
    expect(registry.get('dark').create({ C }).provider.url).toBe('https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png')
  })

  it('preserves injected deployment bases for offline imagery', async() => {
    const layer = await createImageryRegistry().get('offline').create({ C: cesium(), baseUrl: '/embedded/' })
    expect(layer.provider.url).toBe('/embedded/cesium/Assets/Textures/NaturalEarthII')
  })

  it('falls back to an available layer when the configured initial layer is unknown', () => {
    process.env.VUE_APP_MAP_DEFAULT_LAYER = 'missing-layer'
    expect(getMapConfig().defaultLayer).toBe('esri-satellite')
  })

  it.each(['offline', 'esri-satellite', 'google-satellite', 'dark'])('accepts %s as the initial layer', layer => {
    process.env.VUE_APP_MAP_DEFAULT_LAYER = ` ${layer} `
    expect(getMapConfig().defaultLayer).toBe(layer)
  })
})
