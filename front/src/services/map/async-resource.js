export function abortError() {
  const error = new Error('地图图层请求已取消')
  error.name = 'AbortError'
  return error
}

// All timers and abort listeners are removed whichever operation finishes first.
export function withTimeout(operation, { signal, timeoutMs = 10000, message = '地图图层加载超时' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(value)
    }
    const cancel = () => finish(abortError())
    const timer = setTimeout(() => finish(new Error(message)), timeoutMs)
    if (signal) {
      signal.addEventListener('abort', cancel)
      if (signal.aborted) cancel()
    }
    Promise.resolve(operation).then(value => finish(null, value), error => finish(error))
  })
}
