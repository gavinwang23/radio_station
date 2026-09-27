import { Router } from 'express'
import { sendData } from '../../lib/response.js'
import { GoogleTileService } from './google-service.js'

export function createMapRouter({ config, fetchImpl = globalThis.fetch }) {
  const router = Router()
  const google = new GoogleTileService({ apiKey: config.maps.googleApiKey, apiBaseUrl: config.maps.googleApiBaseUrl, fetchImpl })
  router.get('/config', (req, res) => sendData(res, {
    defaultBasemap: 'esri-satellite',
    providers: [
      { id: 'esri-satellite', label: 'Esri 卫星图', configured: true },
      { id: 'google-satellite', label: 'Google 卫星图', configured: Boolean(config.maps.googleApiKey) },
      { id: 'dark', label: 'CARTO 地图', configured: true },
      { id: 'offline', label: '本地低精度底图', configured: true }
    ]
  }))
  router.get('/google/tiles/:z/:x/:y', async (req, res) => {
    const tile = await google.getTile(req.params.z, req.params.x, req.params.y)
    res.set('Content-Type', tile.contentType)
    res.set('Cache-Control', 'no-store')
    res.send(tile.body)
  })
  router.get('/google/viewport', async (req, res) => {
    const viewport = await google.getViewport(req.query)
    res.set('Cache-Control', 'no-store')
    sendData(res, viewport)
  })
  return router
}
