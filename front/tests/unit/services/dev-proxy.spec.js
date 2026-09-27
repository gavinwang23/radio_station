/** @jest-environment node */
const http = require('http')
const express = require('express')
const proxy = require('http-proxy-middleware')
const development = require('../../../vue.config').devServer

describe('real development API proxy', () => {
  let servers
  let sockets
  let port
  function listen(app) {
    const server = http.createServer(app)
    servers.push(server)
    server.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
  }
  function request(path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, method: 'PUT', path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }))
      })
      req.setTimeout(1500, () => req.destroy(new Error('Development proxy did not forward the complete JSON body')))
      req.on('error', reject)
      req.end(body)
    })
  }
  beforeEach(async() => {
    servers = []
    sockets = new Set()
    const upstream = express()
    upstream.use(express.json())
    upstream.put('/api/v1/adsb/source', (req, res) => res.json({ ok: true, data: req.body }))
    const upstreamPort = await listen(upstream)
    const app = express()
    const [prefix, options] = Object.entries(development.proxy)[0]
    if (development.before) development.before(app)
    app.use(proxy(prefix, { ...options, target: `http://127.0.0.1:${upstreamPort}`, logLevel: 'silent' }))
    app.use((req, res) => res.status(404).json({ error: 'not_found' }))
    port = await listen(app)
  })
  afterEach(async() => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  })
  it('forwards a JSON source update using the actual development proxy configuration', async() => {
    const prefix = Object.keys(development.proxy)[0]
    expect(await request(`${prefix}/adsb/source`, '{"host":"192.168.1.70","port":30002,"enabled":true}')).toEqual({
      status: 200, body: { ok: true, data: { host: '192.168.1.70', port: 30002, enabled: true }}
    })
  })
  it('does not serve the removed template mock endpoints', async() => {
    expect((await request('/dev-api/vue-admin-template/user/login', '{}')).status).toBe(404)
  })
})
