import { abortError, withTimeout } from './async-resource'
import { getApiUrl } from '@/config/endpoints'
import { getMapConfig } from './map-config'

export function escapeCredit(text) {
  return String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

export function getViewport(viewer, C) {
  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
  if (!rectangle) throw new Error('无法取得地图视口')
  const degrees = radians => C.Math.toDegrees(radians)
  const west = degrees(rectangle.west)
  const east = degrees(rectangle.east)
  const span = east >= west ? east - west : east - west + 360
  const width = viewer.scene.canvas.clientWidth || viewer.scene.canvas.width || 1024
  const zoom = Math.max(0, Math.min(19, Math.floor(Math.log2(width * 360 / (Math.max(span, 0.000001) * 256)))))
  return {
    zoom,
    north: Math.min(89.9999, degrees(rectangle.north)),
    south: Math.max(-89.9999, degrees(rectangle.south)),
    east,
    west
  }
}

export async function probeImagery(provider, { C, viewer, signal }) {
  const viewport = getViewport(viewer, C)
  const longitude = (viewport.west + (viewport.east >= viewport.west ? viewport.east - viewport.west : viewport.east - viewport.west + 360) / 2 + 540) % 360 - 180
  const latitude = (viewport.north + viewport.south) / 2
  const position = C.Cartographic.fromDegrees(longitude, latitude)
  const level = Math.min(viewport.zoom, provider.maximumLevel == null ? 19 : provider.maximumLevel)
  const tile = provider.tilingScheme.positionToTileXY(position, level)
  if (!tile) throw new Error('当前视口没有可用瓦片')
  // An undefined request means Cesium's request scheduler is busy, not a failed tile.
  for (let retry = 0; retry < 20; retry++) {
    if (signal && signal.aborted) throw abortError()
    const request = provider.requestImage(tile.x, tile.y, level)
    if (request) {
      const image = await request
      if (!image) throw new Error('瓦片响应为空')
      return image
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('瓦片请求队列繁忙')
}

async function googleImagery({ C, viewer, signal, fetch: fetcher = window.fetch.bind(window), onFatalError = () => {} }) {
  let disposed = false
  let removeCamera
  let requestVersion = 0
  let activeCredit
  let pendingCredit
  let attached = false
  let requestController
  const creditDisplay = viewer.creditDisplay
  const config = getMapConfig()
  const provider = new C.UrlTemplateImageryProvider({ url: getApiUrl(config.googleTilesPath), maximumLevel: 19, credit: new C.Credit('Google Maps', true) })
  const update = async() => {
    const version = ++requestVersion
    if (requestController) requestController.abort()
    requestController = typeof AbortController === 'undefined' ? null : new AbortController()
    const viewport = getViewport(viewer, C)
    const query = Object.keys(viewport).map(key => `${key}=${encodeURIComponent(viewport[key])}`).join('&')
    const response = await withTimeout(fetcher(`${getApiUrl(config.googleViewportPath)}?${query}`, { signal: requestController ? requestController.signal : signal }), { signal, message: 'Google Maps 归属信息请求超时' })
    if (!response.ok) throw new Error(`Google Maps API HTTP ${response.status}`)
    const body = await response.json()
    if (!body.ok || !body.data || !body.data.copyright) throw new Error(body.error || 'Google Maps API 尚未配置或归属信息不可用')
    if (disposed || version !== requestVersion || (signal && signal.aborted)) return
    pendingCredit = new C.Credit(escapeCredit(body.data.copyright), true)
    if (!attached) return
    if (activeCredit) creditDisplay.removeStaticCredit(activeCredit)
    activeCredit = pendingCredit
    creditDisplay.addStaticCredit(activeCredit)
    viewer.scene.requestRender()
  }
  try { await update() } catch (error) { if (requestController) requestController.abort(); throw error }
  return {
    provider,
    attach() {
      attached = true
      if (pendingCredit) { activeCredit = pendingCredit; creditDisplay.addStaticCredit(activeCredit) }
      removeCamera = viewer.camera.moveEnd.addEventListener(() => {
        const request = update()
        const version = requestVersion
        request.catch(error => {
          if (!disposed && version === requestVersion && error.name !== 'AbortError') onFatalError(error)
        })
      })
    },
    dispose() {
      disposed = true
      requestVersion++
      if (requestController) requestController.abort()
      if (removeCamera) removeCamera()
      if (activeCredit) creditDisplay.removeStaticCredit(activeCredit)
    }
  }
}

export function createImageryRegistry() {
  const entries = new Map()
  const registry = {
    register(entry) {
      if (!entry || !entry.id || typeof entry.create !== 'function') throw new Error('地图图层需要 id 和 create 方法')
      entries.set(entry.id, entry)
      return () => { if (entries.get(entry.id) === entry) entries.delete(entry.id) }
    },
    get(id) { return entries.get(id) },
    list() { return [...entries.values()].map(({ id, label }) => ({ id, label })) }
  }
  registry.register({
    id: 'offline', label: '本地自然地球',
    async create({ C, baseUrl }) {
      const provider = await C.TileMapServiceImageryProvider.fromUrl(getMapConfig({ baseUrl }).offlineUrl, { maximumLevel: 2, credit: new C.Credit('Natural Earth', true) })
      return { provider }
    }
  })
  registry.register({
    id: 'esri-satellite', label: 'Esri 卫星影像',
    create({ C }) {
      return { provider: new C.UrlTemplateImageryProvider({
        url: getMapConfig().esriUrl,
        maximumLevel: 19,
        credit: new C.Credit('Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community', true)
      }) }
    }
  })
  registry.register({
    id: 'dark', label: 'CARTO 深色地图',
    create({ C }) {
      return { provider: new C.UrlTemplateImageryProvider({
        url: getMapConfig().cartoUrl, maximumLevel: 19,
        credit: new C.Credit('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>', true)
      }) }
    }
  })
  registry.register({ id: 'google-satellite', label: 'Google Maps 卫星影像', create: googleImagery })
  return registry
}
