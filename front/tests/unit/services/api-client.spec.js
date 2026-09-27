import { createApiClient } from '@/services/http/api-client'

describe('platform API client', () => {
  it('uses the configured platform API address for GET and PUT requests', async() => {
    const previous = process.env.VUE_APP_API_BASE_URL
    process.env.VUE_APP_API_BASE_URL = 'https://backend.example/api/v1/'
    try {
      const urls = []
      const api = createApiClient({ fetchImpl: async(url) => {
        urls.push(url)
        return { ok: true, status: 200, json: async() => ({ ok: true, data: {} }) }
      } })
      await api.get('health')
      await api.put('adsb/source', { enabled: false })
      expect(urls).toEqual(['https://backend.example/api/v1/health', 'https://backend.example/api/v1/adsb/source'])
    } finally {
      if (previous === undefined) delete process.env.VUE_APP_API_BASE_URL
      else process.env.VUE_APP_API_BASE_URL = previous
    }
  })
  it('saves a source configuration as JSON and returns the persisted server result', async() => {
    let saved
    const api = createApiClient({ fetchImpl: async(url, options) => {
      expect(url).toBe('/api/v1/adsb/source')
      expect(options.method).toBe('PUT')
      expect(options.headers['Content-Type']).toBe('application/json')
      saved = JSON.parse(options.body)
      return { ok: true, status: 200, json: async() => ({ ok: true, data: { source: saved, persisted: true } }) }
    } })
    const source = { host: '192.168.1.8', port: 30002, enabled: true }
    const result = await api.put('adsb/source', source)
    expect(result).toEqual({ source, persisted: true })
  })
  it('unwraps the platform envelope and retains legacy dump1090 responses', async() => {
    const responses = [{ ok: true, data: { aircraft: [] } }, [{ hex: 'abc123' }]]
    const api = createApiClient({ fetchImpl: async() => ({ ok: true, status: 200, json: async() => responses.shift() }) })
    expect(await api.get('adsb/snapshot')).toEqual({ aircraft: [] })
    expect(await api.get('/aircraft.json')).toEqual([{ hex: 'abc123' }])
  })

  it('surfaces a platform error even when HTTP succeeds', async() => {
    const api = createApiClient({ fetchImpl: async() => ({ ok: true, status: 200, json: async() => ({ ok: false, error: { code: 'SOURCE_NOT_CONFIGURED', message: '未配置接收源' } }) }) })
    await expect(api.get('adsb/snapshot')).rejects.toMatchObject({ code: 'SOURCE_NOT_CONFIGURED', message: '未配置接收源' })
  })

  it('reports non-JSON responses without leaking the response document', async() => {
    const api = createApiClient({ fetchImpl: async() => ({ ok: true, status: 200, json: async() => { throw new Error('private document') } }) })
    await expect(api.get('modules')).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })
})
