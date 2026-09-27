import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { loadConfig } from '../../src/config.js'
import { GoogleTileService, validateTile, validateViewport } from '../../src/modules/maps/google-service.js'
import { createMapRouter } from '../../src/modules/maps/router.js'

const session = () => Response.json({ session: 'test-session', expiry: '2000000000', tileWidth: 256, tileHeight: 256, imageFormat: 'jpeg' })

test('does not make a request when Google credentials are not configured', async () => {
  const service = new GoogleTileService({ apiKey: '', fetchImpl: () => { throw new Error('unexpected request') } })
  await assert.rejects(service.getTile(1, 0, 0), error => error.code === 'GOOGLE_MAPS_NOT_CONFIGURED' && error.status === 503)
})

test('tile bounds are validated before contacting the upstream', () => {
  assert.throws(() => validateTile('0', '1', '0'), error => error.status === 400)
  assert.throws(() => validateTile('1.5', '0', '0'), error => error.status === 400)
  assert.deepEqual(validateTile('2', '0', '3'), { z: 2, x: 0, y: 3 })
  assert.throws(() => validateViewport({ north: 30, south: 40, east: 121, west: 120, zoom: 8 }), error => error.status === 400)
})

test('concurrent tile requests share a session and use the official endpoint', async () => {
  const requests = []
  const service = new GoogleTileService({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('createSession')) return session()
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=1800' } })
  } })
  const [tile] = await Promise.all([service.getTile(2, 1, 1), service.getTile(2, 1, 2)])
  assert.equal(requests.filter(request => request.url.includes('createSession')).length, 1)
  assert.equal(JSON.parse(requests[0].options.body).mapType, 'satellite')
  assert.ok(requests.some(request => request.url === 'https://tile.googleapis.com/v1/2dtiles/2/1/1?session=test-session&key=test-key'))
  assert.equal(tile.contentType, 'image/jpeg')
  assert.deepEqual(Array.from(tile.body), [1, 2, 3])
})

test('a custom Google Maps base URL preserves the proxy prefix for every upstream endpoint', async () => {
  for (const apiBaseUrl of ['https://maps.example/google/tiles', 'https://maps.example/google/tiles///']) {
    const requests = []
    const service = new GoogleTileService({ apiKey: 'test-key', apiBaseUrl, fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options })
      if (String(url).includes('createSession')) return session()
      if (String(url).includes('/viewport?')) return Response.json({ copyright: 'Test attribution', maxZoomRects: [] })
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
    } })
    const tile = await service.getTile(2, 1, 1)
    const viewport = await service.getViewport({ north: 32, south: 30, east: 122, west: 120, zoom: 8 })
    assert.deepEqual(requests.map(request => request.url), [
      'https://maps.example/google/tiles/v1/createSession?key=test-key',
      'https://maps.example/google/tiles/v1/2dtiles/2/1/1?session=test-session&key=test-key',
      'https://maps.example/google/tiles/tile/v1/viewport?session=test-session&zoom=8&north=32&south=30&east=122&west=120&key=test-key'
    ])
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(Array.from(tile.body), [1, 2, 3])
    assert.equal(viewport.copyright, 'Test attribution')
  }
})

test('the map route forwards the configured Google Maps base URL to upstream requests', async t => {
  const requests = []
  const config = loadConfig({ GOOGLE_MAPS_API_KEY: 'test-key', GOOGLE_MAPS_API_BASE_URL: 'http://maps.example/proxy/' })
  const app = express()
  app.use('/maps', createMapRouter({ config, fetchImpl: async url => {
    requests.push(String(url))
    if (String(url).includes('createSession')) return session()
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
  } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/maps/google/tiles/2/1/1`)
  assert.equal(response.status, 200)
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [1, 2, 3])
  assert.deepEqual(requests, [
    'http://maps.example/proxy/v1/createSession?key=test-key',
    'http://maps.example/proxy/v1/2dtiles/2/1/1?session=test-session&key=test-key'
  ])
})

test('upstream failures do not expose API keys or private upstream messages', async () => {
  const service = new GoogleTileService({ apiKey: 'private-key', fetchImpl: async () => new Response('private-key upstream internal detail', { status: 403 }) })
  await assert.rejects(service.getTile(1, 0, 0), error => error.status === 502 && !error.message.includes('private-key') && !error.message.includes('internal detail'))
})

test('viewport returns only display attribution and validated zoom rectangles', async () => {
  const service = new GoogleTileService({ apiKey: 'test-key', fetchImpl: async url => {
    if (String(url).includes('createSession')) return session()
    assert.equal(new URL(url).pathname, '/tile/v1/viewport')
    return Response.json({ copyright: 'Map data ©2026', maxZoomRects: [{ maxZoom: 18, north: 90, south: -90, west: -180, east: 180 }], secret: 'not-public' })
  } })
  const result = await service.getViewport({ north: 32, south: 30, east: 122, west: 120, zoom: 8 })
  assert.equal(result.copyright, 'Map data ©2026')
  assert.equal(result.secret, undefined)
})
