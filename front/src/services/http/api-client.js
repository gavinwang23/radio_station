import { getApiBaseUrl, getApiTimeoutMs, getApiUrl } from '@/config/endpoints'

export class ApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0 } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function cancelled() {
  const error = new ApiError('请求已取消', { code: 'CANCELLED' })
  error.name = 'AbortError'
  return error
}

export function createApiClient({ baseUrl = getApiBaseUrl(), fetchImpl, timeoutMs = getApiTimeoutMs() } = {}) {
  const base = baseUrl.replace(/\/$/, '')
  async function request(method, path, body, options = {}) {
    const url = getApiUrl(path, base)
    const signal = options.signal
    if (signal && signal.aborted) throw cancelled()
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    let timer
    let abortListener
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort()
        reject(new ApiError('接口请求超时', { code: 'REQUEST_TIMEOUT' }))
      }, options.timeoutMs || timeoutMs)
    })
    const aborted = new Promise((resolve, reject) => {
      if (!signal || typeof signal.addEventListener !== 'function') return
      abortListener = () => {
        if (controller) controller.abort()
        reject(cancelled())
      }
      signal.addEventListener('abort', abortListener, { once: true })
    })
    const fetcher = fetchImpl || ((...args) => fetch(...args))
    const load = async() => {
      const response = await fetcher(url, {
        method, signal: controller ? controller.signal : signal, cache: 'no-store',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      let payload
      try { payload = await response.json() } catch (error) {
        throw new ApiError(response.ok ? '接口返回内容不是有效 JSON' : `接口返回 HTTP ${response.status}`, { code: response.ok ? 'INVALID_JSON' : 'HTTP_ERROR', status: response.status })
      }
      if (payload && payload.ok === false) throw new ApiError(payload.error && payload.error.message || '接口请求失败', { code: payload.error && payload.error.code || 'API_ERROR', status: response.status })
      if (!response.ok) throw new ApiError(`接口返回 HTTP ${response.status}`, { code: 'HTTP_ERROR', status: response.status })
      return payload && payload.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload
    }
    try { return await Promise.race([load(), timeout, aborted]) } finally {
      clearTimeout(timer)
      if (abortListener) signal.removeEventListener('abort', abortListener)
    }
  }
  return {
    get: (path, options) => request('GET', path, undefined, options),
    put: (path, body, options) => request('PUT', path, body, options),
    post: (path, body, options) => request('POST', path, body, options)
  }
}

export const platformApi = createApiClient()
