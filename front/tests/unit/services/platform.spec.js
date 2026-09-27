import { readPlatformState, sourceErrorMessage } from '@/services/platform'

it('retains healthy module information when the database check fails', async() => {
  const api = { get: async path => {
    if (path === 'database/status') throw new Error('database offline')
    if (path === 'modules') return [{ id: 'adsb', status: 'configured' }]
    return { status: 'ok' }
  } }
  const state = await readPlatformState(null, api)
  expect(state.backend).toBe('available')
  expect(state.database.status).toBe('unavailable')
  expect(state.modules).toEqual([{ id: 'adsb', status: 'configured' }])
})

it('explains an unconfigured receiver without treating it as live data', () => {
  expect(sourceErrorMessage({ code: 'ADSB_SOURCE_UNCONFIGURED' })).toContain('尚未配置')
})
