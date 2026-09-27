import { AppError } from '../../lib/errors.js'
import { DEFAULT_GOOGLE_MAPS_API_BASE_URL } from '../../config.js'

const upstreamError = () => new AppError(502, 'GOOGLE_MAPS_UNAVAILABLE', 'Google 地图服务暂不可用，请检查 API 配置和网络')

function scalarNumber(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return NaN
  return Number(value)
}

export function validateTile(zInput, xInput, yInput) {
  const z = scalarNumber(zInput)
  const x = scalarNumber(xInput)
  const y = scalarNumber(yInput)
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new AppError(400, 'INVALID_TILE', '无效的地图瓦片坐标')
  }
  return { z, x, y }
}

export function validateViewport(input) {
  const result = Object.fromEntries(['zoom', 'north', 'south', 'east', 'west'].map(key => [key, scalarNumber(input[key])]))
  if (!Object.values(result).every(Number.isFinite) || !Number.isInteger(result.zoom) || result.zoom < 0 || result.zoom > 22 || result.north >= 90 || result.south <= -90 || result.north <= result.south || Math.abs(result.east) > 180 || Math.abs(result.west) > 180) {
    throw new AppError(400, 'INVALID_VIEWPORT', '无效的地图视口范围')
  }
  return result
}

export class GoogleTileService {
  constructor({ apiKey = '', apiBaseUrl = DEFAULT_GOOGLE_MAPS_API_BASE_URL, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
    this.apiKey = apiKey
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '')
    this.fetch = fetchImpl
    this.now = now
    this.timeoutMs = timeoutMs
    this.session = null
    this.pendingSession = null
  }

  async request(path, options = {}) {
    if (!this.apiKey) throw new AppError(503, 'GOOGLE_MAPS_NOT_CONFIGURED', '尚未配置 Google Maps API Key，可先使用备用卫星底图')
    const url = new URL(path.replace(/^\/+/, ''), `${this.apiBaseUrl}/`)
    url.searchParams.set('key', this.apiKey)
    try {
      const response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) throw upstreamError()
      return response
    } catch (error) {
      if (error instanceof AppError) throw error
      throw upstreamError()
    }
  }

  async getSession() {
    if (this.session && this.session.expiresAt > this.now() + 60000) return this.session
    if (this.pendingSession) return this.pendingSession
    this.pendingSession = (async () => {
      const response = await this.request('/v1/createSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapType: 'satellite', language: 'zh-CN', region: 'CN', imageFormat: 'jpeg' })
      })
      let data
      try { data = await response.json() } catch { throw upstreamError() }
      const expiresAt = Number(data.expiry) * 1000
      if (typeof data.session !== 'string' || !data.session || !Number.isFinite(expiresAt) || expiresAt <= this.now() || data.tileWidth !== 256 || data.tileHeight !== 256) throw upstreamError()
      this.session = { token: data.session, expiresAt }
      return this.session
    })()
    try { return await this.pendingSession } finally { this.pendingSession = null }
  }

  async getTile(zInput, xInput, yInput) {
    const { z, x, y } = validateTile(zInput, xInput, yInput)
    const session = await this.getSession()
    const response = await this.request(`/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session.token)}`)
    const contentType = response.headers.get('content-type') || ''
    if (!/^image\/(jpeg|png)(;|$)/i.test(contentType)) throw upstreamError()
    let body
    try { body = Buffer.from(await response.arrayBuffer()) } catch { throw upstreamError() }
    if (body.length > 4 * 1024 * 1024) throw upstreamError()
    return { body, contentType }
  }

  async getViewport(input) {
    const viewport = validateViewport(input)
    const session = await this.getSession()
    const parameters = new URLSearchParams({ session: session.token, ...viewport })
    const response = await this.request(`/tile/v1/viewport?${parameters}`)
    let data
    try { data = await response.json() } catch { throw upstreamError() }
    if (typeof data.copyright !== 'string' || !data.copyright || data.copyright.length > 10000) throw upstreamError()
    const maxZoomRects = (Array.isArray(data.maxZoomRects) ? data.maxZoomRects : []).filter(rect => rect && ['maxZoom', 'north', 'south', 'east', 'west'].every(key => Number.isFinite(rect[key]))).map(({ maxZoom, north, south, east, west }) => ({ maxZoom, north, south, east, west }))
    return { copyright: data.copyright, maxZoomRects }
  }
}
