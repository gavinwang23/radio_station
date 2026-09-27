import { getWebSocketUrl } from '@/config/endpoints'

const heartbeatTimeoutMs = 10000

// This transport is shared by event consumers. ADS-B decoding stays on the server.
export function createRealtimeClient({ url, WebSocketImpl, onMessage = () => {}, onStatus = () => {} } = {}) {
  let active = false
  let generation = 0
  let socket = null
  let retryTimer = null
  let heartbeatTimer = null
  let attempts = 0

  function clearHeartbeat() { clearTimeout(heartbeatTimer); heartbeatTimer = null }
  function detach(connection) {
    if (!connection) return
    connection.onopen = connection.onmessage = connection.onclose = connection.onerror = null
    if (connection.readyState < 2) connection.close()
  }
  function current(id) { return active && id === generation }
  function reconnect(id, message) {
    if (!current(id)) return
    generation++
    clearHeartbeat()
    const previous = socket
    socket = null
    detach(previous)
    const retryInMs = Math.min(1000 * Math.pow(2, Math.min(attempts++, 4)), 15000)
    onStatus({ state: 'reconnecting', connected: false, message, retryInMs })
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, retryInMs)
  }
  function heartbeat(id) {
    clearHeartbeat()
    heartbeatTimer = setTimeout(() => reconnect(id, '推送通道超过 10 秒未更新，正在重连'), heartbeatTimeoutMs)
  }
  function connect() {
    if (!active) return
    const id = ++generation
    onStatus({ state: 'connecting', connected: false, message: '正在连接推送通道' })
    const Constructor = WebSocketImpl || (typeof WebSocket === 'undefined' ? null : WebSocket)
    if (!Constructor) {
      onStatus({ state: 'error', connected: false, message: '当前浏览器不支持 WebSocket' })
      return
    }
    try { socket = new Constructor(url || getWebSocketUrl()) } catch (error) { reconnect(id, '无法打开推送通道，正在重连'); return }
    heartbeat(id)
    socket.onopen = () => {
      if (!current(id)) return
      heartbeat(id)
      onStatus({ state: 'connected', connected: true, message: '推送通道已连接' })
    }
    socket.onmessage = event => {
      if (!current(id)) return
      let payload
      try { payload = JSON.parse(event.data) } catch (error) { return }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
      attempts = 0
      heartbeat(id)
      onMessage(payload)
    }
    socket.onclose = () => reconnect(id, '推送通道已断开，正在重连')
    socket.onerror = () => reconnect(id, '推送通道连接异常，正在重连')
  }

  return {
    start() {
      if (active) return
      active = true
      attempts = 0
      connect()
    },
    stop() {
      if (!active) return
      active = false
      generation++
      clearTimeout(retryTimer)
      retryTimer = null
      clearHeartbeat()
      const previous = socket
      socket = null
      detach(previous)
      onStatus({ state: 'stopped', connected: false, message: '推送通道未订阅' })
    }
  }
}
