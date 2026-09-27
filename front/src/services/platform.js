import { platformApi } from './http/api-client'

// A failed data source does not prevent other modules from reporting their state.
export async function readPlatformState(signal, api = platformApi) {
  const paths = ['health', 'modules', 'database/status', 'adsb/catalog/schema', 'maps/config']
  const results = await Promise.allSettled(paths.map(path => api.get(path, { signal })))
  const value = (index, fallback) => results[index].status === 'fulfilled' ? results[index].value : fallback
  return {
    backend: results[0].status === 'fulfilled' ? 'available' : 'unavailable',
    modules: value(1, []),
    database: value(2, { status: 'unavailable' }),
    catalog: value(3, { status: 'unavailable' }),
    maps: value(4, null)
  }
}

export function sourceErrorMessage(error) {
  const messages = {
    ADSB_SOURCE_UNCONFIGURED: '后端尚未配置 ADS-B 接收源',
    ADSB_SOURCE_UNAVAILABLE: '后端无法访问 ADS-B 接收源',
    ADSB_SOURCE_INVALID: 'ADS-B 接收源返回了无效数据',
    ADSB_SOURCE_TIMEOUT: 'ADS-B 接收源请求超时，将自动重试',
    REQUEST_TIMEOUT: '连接超时，将自动重试',
    HTTP_ERROR: '接口请求失败，请检查服务地址',
    INVALID_JSON: '接口未返回有效 JSON 数据'
  }
  return messages[error.code] || (error.name === 'AbortError' ? '连接超时，将自动重试' : `${error.message || '连接失败'}，请检查地址与跨域配置`)
}
