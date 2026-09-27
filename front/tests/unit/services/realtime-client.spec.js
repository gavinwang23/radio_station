import { createRealtimeClient } from '@/services/realtime/client'

class TestSocket {
  constructor(url) { this.url = url; this.readyState = 0; TestSocket.instances.push(this) }
  open() { this.readyState = 1; if (this.onopen) this.onopen({}) }
  message(data) { if (this.onmessage) this.onmessage({ data }) }
  close() { this.readyState = 3; if (this.onclose) this.onclose({}) }
}
TestSocket.instances = []

describe('realtime client lifecycle', () => {
  let client
  let messages
  let statuses
  beforeEach(() => {
    jest.useFakeTimers()
    TestSocket.instances = []
    messages = []
    statuses = []
    client = createRealtimeClient({ WebSocketImpl: TestSocket, onMessage: value => messages.push(value), onStatus: value => statuses.push(value) })
  })
  afterEach(() => { client.stop(); jest.clearAllTimers(); jest.useRealTimers() })

  it('uses the same origin stream and forwards parsed event envelopes', () => {
    client.start()
    const socket = TestSocket.instances[0]
    expect(socket.url).toBe('ws://localhost/api/v1/stream')
    socket.open()
    socket.message(JSON.stringify({ type: 'adsb.snapshot', data: { snapshot: { aircraft: [] }}}))
    expect(messages).toEqual([{ type: 'adsb.snapshot', data: { snapshot: { aircraft: [] }}}])
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'connected', connected: true })
  })

  it('derives a secure websocket address from the configured API and permits an explicit stream URL', () => {
    const previousApi = process.env.VUE_APP_API_BASE_URL
    const previousWs = process.env.VUE_APP_WS_URL
    try {
      process.env.VUE_APP_API_BASE_URL = 'https://backend.example/api/v1'
      delete process.env.VUE_APP_WS_URL
      client.start()
      expect(TestSocket.instances[0].url).toBe('wss://backend.example/api/v1/stream')
      client.stop()
      process.env.VUE_APP_WS_URL = 'wss://stream.example/events'
      client.start()
      expect(TestSocket.instances[1].url).toBe('wss://stream.example/events')
    } finally {
      if (previousApi === undefined) delete process.env.VUE_APP_API_BASE_URL
      else process.env.VUE_APP_API_BASE_URL = previousApi
      if (previousWs === undefined) delete process.env.VUE_APP_WS_URL
      else process.env.VUE_APP_WS_URL = previousWs
    }
  })

  it('reconnects a failed stream with delays bounded at fifteen seconds', () => {
    client.start()
    for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
      const count = TestSocket.instances.length
      TestSocket.instances[count - 1].close()
      expect(statuses[statuses.length - 1]).toMatchObject({ state: 'reconnecting', connected: false })
      jest.advanceTimersByTime(delay - 1)
      expect(TestSocket.instances).toHaveLength(count)
      jest.advanceTimersByTime(1)
      expect(TestSocket.instances).toHaveLength(count + 1)
    }
  })

  it('resets reconnect backoff after receiving a message', () => {
    client.start()
    TestSocket.instances[0].close()
    jest.advanceTimersByTime(1000)
    const socket = TestSocket.instances[1]
    socket.open()
    socket.message('{"type":"heartbeat"}')
    socket.close()
    jest.advanceTimersByTime(1000)
    expect(TestSocket.instances).toHaveLength(3)
  })

  it('expires a quiet socket and waits for fresh heartbeat messages', () => {
    client.start()
    const socket = TestSocket.instances[0]
    socket.open()
    jest.advanceTimersByTime(9000)
    socket.message('{"type":"heartbeat"}')
    jest.advanceTimersByTime(9000)
    expect(socket.readyState).toBe(1)
    jest.advanceTimersByTime(1000)
    expect(socket.readyState).toBe(3)
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'reconnecting', connected: false })
    jest.advanceTimersByTime(1000)
    expect(TestSocket.instances).toHaveLength(2)
  })

  it('ignores delayed callbacks and cancels heartbeat and retries after stop', () => {
    client.start()
    const socket = TestSocket.instances[0]
    const delayedMessage = socket.onmessage
    const delayedClose = socket.onclose
    socket.open()
    client.stop()
    const count = statuses.length
    delayedMessage({ data: '{"type":"adsb.snapshot"}' })
    delayedClose({})
    jest.advanceTimersByTime(60000)
    expect(messages).toEqual([])
    expect(statuses).toHaveLength(count)
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('rejects malformed packets while keeping the next valid event usable', () => {
    client.start()
    const socket = TestSocket.instances[0]
    socket.open()
    socket.message('broken JSON')
    socket.message('{"type":"adsb.snapshot","data":{}}')
    expect(messages).toEqual([{ type: 'adsb.snapshot', data: {}}])
  })

  it('makes repeated starts idempotent and permits restarting after stop', () => {
    client.start()
    client.start()
    expect(TestSocket.instances).toHaveLength(1)
    client.stop()
    client.start()
    expect(TestSocket.instances).toHaveLength(2)
  })
})
