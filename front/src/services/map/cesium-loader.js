import { getMapConfig } from './map-config'

export function createCesiumLoader({ browser = window, document: page = document, baseUrl, timeoutMs = 10000 } = {}) {
  let pending
  return function load() {
    if (browser.Cesium) return Promise.resolve(browser.Cesium)
    if (pending) return pending
    const base = getMapConfig({ baseUrl }).cesiumBaseUrl
    browser.CESIUM_BASE_URL = base
    pending = new Promise((resolve, reject) => {
      const script = page.createElement('script')
      let settled = false
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        script.onload = null
        script.onerror = null
        if (error) {
          pending = null
          script.remove()
          reject(error)
        } else resolve(browser.Cesium)
      }
      const timer = setTimeout(() => finish(new Error('Cesium 加载超时，请检查本地静态资源并重试')), timeoutMs)
      script.src = `${base}Cesium.js`
      script.async = true
      script.onload = () => finish(browser.Cesium ? null : new Error('Cesium 脚本未正确初始化'))
      script.onerror = () => finish(new Error('Cesium 加载失败，请检查本地静态资源'))
      page.head.appendChild(script)
    })
    return pending
  }
}

let defaultLoader
export function loadCesium() {
  if (!defaultLoader) defaultLoader = createCesiumLoader()
  return defaultLoader()
}
