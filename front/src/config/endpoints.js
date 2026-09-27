// Vue CLI injects VUE_APP_* values at build time. Keep service endpoints in .env.
export function getApiBaseUrl() {
  return (process.env.VUE_APP_API_BASE_URL || '/api/v1').trim().replace(/\/+$/, '') || '/api/v1'
}

export function getApiUrl(path, baseUrl = getApiBaseUrl()) {
  if (/^(https?:\/\/|\/)/i.test(path)) return path
  return `${baseUrl.replace(/\/+$/, '')}/${path}`
}

export function getApiTimeoutMs() {
  const value = Number(process.env.VUE_APP_API_TIMEOUT_MS)
  return Number.isInteger(value) && value > 0 && value <= 120000 ? value : 8000
}

export function getWebSocketUrl(location = window.location) {
  const configured = (process.env.VUE_APP_WS_URL || '').trim()
  const address = new URL(configured || getApiUrl('stream'), location.href)
  if (address.protocol === 'http:') address.protocol = 'ws:'
  else if (address.protocol === 'https:') address.protocol = 'wss:'
  if (!['ws:', 'wss:'].includes(address.protocol)) throw new Error('推送地址必须使用 ws 或 wss 协议')
  return address.href
}
