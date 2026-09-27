function configured(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function directory(value) {
  return `${value.replace(/\/+$/, '')}/`
}

export function getMapConfig({ baseUrl } = {}) {
  const deploymentBase = directory(configured(baseUrl, configured(process.env.BASE_URL, '/')))
  const cesiumBaseUrl = directory(baseUrl === undefined
    ? configured(process.env.VUE_APP_CESIUM_BASE_URL, `${deploymentBase}cesium/`)
    : `${deploymentBase}cesium/`)
  const defaultLayer = configured(process.env.VUE_APP_MAP_DEFAULT_LAYER, 'esri-satellite')

  return {
    defaultLayer: ['offline', 'esri-satellite', 'google-satellite', 'dark'].includes(defaultLayer) ? defaultLayer : 'esri-satellite',
    cesiumBaseUrl,
    offlineUrl: configured(process.env.VUE_APP_MAP_OFFLINE_URL, `${cesiumBaseUrl}Assets/Textures/NaturalEarthII`),
    esriUrl: configured(process.env.VUE_APP_MAP_ESRI_URL, 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'),
    cartoUrl: configured(process.env.VUE_APP_MAP_CARTO_URL, 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'),
    googleTilesPath: configured(process.env.VUE_APP_MAP_GOOGLE_TILES_PATH, 'maps/google/tiles/{z}/{x}/{y}'),
    googleViewportPath: configured(process.env.VUE_APP_MAP_GOOGLE_VIEWPORT_PATH, 'maps/google/viewport')
  }
}
