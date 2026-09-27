<template>
  <div class="cesium-map">
    <div ref="container" class="cesium-canvas" />
    <div v-if="loading || error" class="map-message" :class="{ 'map-message-error': error }">
      <span>{{ error || '正在加载空域地图…' }}</span>
      <button v-if="error" @click="initialize">重新加载</button>
    </div>
    <div v-if="!error" class="map-basemap-status" role="status">
      {{ actualBasemap.label }}<span v-if="basemapLoading"> · 正在连接所选底图</span><span v-else-if="actualBasemap.fallback"> · 备用底图</span>
    </div>
    <div v-if="basemapNotice && actualBasemap.fallback && !error" class="tile-notice">{{ basemapNotice }}</div>
    <div v-if="actualBasemap.id === 'google-satellite'" class="google-attribution">
      <img :src="googleMapsLogo" alt="Google Maps">
    </div>
  </div>
</template>

<script>
import { loadCesium } from '@/services/map/cesium-loader'
import { createImageryRegistry } from '@/services/map/imagery-registry'
import { createImageryLayerManager } from '@/services/map/imagery-layer-manager'
import { getMapConfig } from '@/services/map/map-config'
import googleMapsLogo from '@/services/map/assets/google-maps-logo.png'

function planeImage(color) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path fill="${color}" stroke="#122232" stroke-width="1.4" d="M24 3c1.5 0 2 2 2 4l1 11 16 12v4l-16-5-1 10 5 4v2l-7-2-7 2v-2l5-4-1-10-16 5v-4l16-12 1-11c0-2 .5-4 2-4z"/></svg>`)}`
}

export default {
  name: 'CesiumAirspaceMap',
  props: {
    basemap: { type: String, default: () => getMapConfig().defaultLayer },
    aircraft: { type: Array, default: () => [] },
    trails: { type: Object, default: () => ({}) },
    selectedId: { type: String, default: '' },
    labels: { type: Boolean, default: true },
    tracks: { type: Boolean, default: true },
    coverage: { type: Boolean, default: true },
    receiverVisible: { type: Boolean, default: true },
    receiver: { type: Object, required: true }
  },
  data() {
    return {
      loading: true, error: '', basemapLoading: false, basemapNotice: '', googleMapsLogo,
      actualBasemap: { id: 'offline', label: '本地自然地球', fallback: false }
    }
  },
  watch: {
    basemap() { this.changeBasemap() },
    aircraft() { this.syncAircraft() },
    selectedId() { this.syncAircraft() },
    labels() { this.syncAircraft() },
    tracks() { this.syncAircraft() },
    coverage() { this.syncReceiver() },
    receiverVisible() { this.syncReceiver() },
    receiver: { deep: true, handler() { this.syncReceiver() } }
  },
  mounted() { this.initialize() },
  beforeDestroy() {
    this._disposed = true
    this.destroyMap()
  },
  methods: {
    async initialize() {
      if (this._initializing || this._disposed) return
      this._initializing = true
      this.destroyMap()
      this.loading = true
      this.error = ''
      this.basemapNotice = ''
      this.actualBasemap = { id: 'offline', label: '本地自然地球', fallback: false }
      try {
        const C = await loadCesium()
        if (this._disposed) return
        this._C = C
        this._viewer = new C.Viewer(this.$refs.container, {
          baseLayer: false,
          terrainProvider: new C.EllipsoidTerrainProvider(),
          animation: false, timeline: false, baseLayerPicker: false,
          geocoder: false, homeButton: false, sceneModePicker: false,
          navigationHelpButton: false, fullscreenButton: false,
          infoBox: false, selectionIndicator: false,
          sceneMode: C.SceneMode.SCENE2D,
          scene3DOnly: false,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          contextOptions: { webgl: { alpha: false }}
        })
        this._viewer.scene.backgroundColor = C.Color.fromCssColorString('#111b25')
        this._viewer.scene.globe.baseColor = C.Color.fromCssColorString('#172633')
        this._viewer.scene.globe.enableLighting = false
        this._viewer.scene.fog.enabled = false
        this._viewer.scene.screenSpaceCameraController.maximumZoomDistance = 12000000
        this._viewer.scene.screenSpaceCameraController.minimumZoomDistance = 3000
        this._imageryManager = createImageryLayerManager({
          C, viewer: this._viewer, registry: createImageryRegistry(),
          onChange: state => {
            this.actualBasemap = state
            if (!state.fallback) this.basemapNotice = ''
            this.$emit('basemap-change', state)
          },
          onError: message => { this.basemapNotice = message; this.$emit('basemap-error', message) }
        })
        await this._imageryManager.initialize()
        if (this._disposed) return
        this._viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        this._entities = new Map()
        this._handler = new C.ScreenSpaceEventHandler(this._viewer.scene.canvas)
        this._handler.setInputAction(event => {
          const hit = this._viewer.scene.pick(event.position)
          const id = hit && hit.id && hit.id.id
          if (id && id.indexOf('aircraft-') === 0) this.$emit('select', id.slice(9))
        }, C.ScreenSpaceEventType.LEFT_CLICK)
        const stopFollowing = () => {
          if (this._following) { this._following = false; this.$emit('unfollow') }
        }
        this._handler.setInputAction(stopFollowing, C.ScreenSpaceEventType.LEFT_DOWN)
        this._handler.setInputAction(stopFollowing, C.ScreenSpaceEventType.WHEEL)
        this._handler.setInputAction(event => {
          const ray = this._viewer.camera.getPickRay(event.endPosition)
          const position = ray && this._viewer.scene.globe.pick(ray, this._viewer.scene)
          if (position) {
            const coordinate = C.Cartographic.fromCartesian(position)
            this.$emit('coordinate', { lat: C.Math.toDegrees(coordinate.latitude), lon: C.Math.toDegrees(coordinate.longitude) })
          }
          const hit = this._viewer.scene.pick(event.endPosition)
          this._viewer.scene.canvas.style.cursor = hit && hit.id && String(hit.id.id).indexOf('aircraft-') === 0 ? 'pointer' : 'grab'
        }, C.ScreenSpaceEventType.MOUSE_MOVE)
        this.addGeography()
        this.syncReceiver()
        this.syncAircraft()
        this.reset()
        this._mapReady = true
        this.changeBasemap()
        this.$emit('ready')
      } catch (error) {
        this.error = error.message || '地图初始化失败，请使用支持 WebGL 的浏览器'
        this.destroyMap()
      } finally { this.loading = false; this._initializing = false }
    },
    destroyMap() {
      this._mapReady = false
      this._basemapVersion = (this._basemapVersion || 0) + 1
      this.basemapLoading = false
      if (this._imageryManager) this._imageryManager.destroy()
      this._imageryManager = null
      if (this._handler && !this._handler.isDestroyed()) this._handler.destroy()
      this._handler = null
      if (this._viewer && !this._viewer.isDestroyed()) this._viewer.destroy()
      this._viewer = null
      this._entities = null
      this._receiverEntities = []
      this._following = false
    },
    async changeBasemap() {
      if (!this._imageryManager || !this._mapReady) return
      const version = this._basemapVersion = (this._basemapVersion || 0) + 1
      this.basemapLoading = true
      this.basemapNotice = ''
      try { await this._imageryManager.setBasemap(this.basemap) } catch (error) {
        if (!this._disposed && version === this._basemapVersion) this.$emit('basemap-error', error.message || '底图切换失败')
      } finally {
        if (!this._disposed && version === this._basemapVersion) this.basemapLoading = false
      }
    },
    addGeography() {
      const C = this._C
      const cities = [['上海', 121.47, 31.23], ['杭州', 120.15, 30.27], ['苏州', 120.58, 31.3], ['无锡', 120.31, 31.57], ['南通', 120.86, 32.01], ['宁波', 121.55, 29.87], ['嘉兴', 120.75, 30.75], ['常州', 119.97, 31.81], ['湖州', 120.09, 30.89], ['舟山', 122.21, 29.99]]
      cities.forEach(([name, lon, lat]) => {
        this._viewer.entities.add({
          position: C.Cartesian3.fromDegrees(lon, lat),
          point: { pixelSize: 3, color: C.Color.fromCssColorString('#91a2ad') },
          label: { text: name, font: '12px "Microsoft YaHei", sans-serif', fillColor: C.Color.fromCssColorString('#9babb9'), pixelOffset: new C.Cartesian2(0, 15), disableDepthTestDistance: Infinity }
        })
      })
      this._viewer.entities.add({ position: C.Cartesian3.fromDegrees(122.9, 30.5), label: { text: '东  海', font: '17px "Microsoft YaHei", sans-serif', fillColor: C.Color.fromCssColorString('#496477') }})
    },
    syncReceiver() {
      if (!this._viewer) return
      const C = this._C
      ;(this._receiverEntities || []).forEach(entity => this._viewer.entities.remove(entity))
      this._receiverEntities = []
      if (!this.receiverVisible) { this._viewer.scene.requestRender(); return }
      const position = C.Cartesian3.fromDegrees(this.receiver.lon, this.receiver.lat)
      this._receiverEntities = [this._viewer.entities.add({
        position,
        point: { pixelSize: 7, color: C.Color.fromCssColorString('#72b7a4'), outlineColor: C.Color.fromCssColorString('#142d2b'), outlineWidth: 4 },
        label: { text: this.receiver.name, font: '11px "Microsoft YaHei", sans-serif', pixelOffset: new C.Cartesian2(0, -20), fillColor: C.Color.fromCssColorString('#91baa9'), show: this.coverage }
      })]
      ;[50000, 100000, 150000].forEach(radius => {
        const coordinates = []
        for (let degrees = 0; degrees <= 360; degrees += 3) {
          const angle = degrees * Math.PI / 180
          const angular = radius / 6371000
          const latitude = this.receiver.lat * Math.PI / 180
          const ringLat = Math.asin(Math.sin(latitude) * Math.cos(angular) + Math.cos(latitude) * Math.sin(angular) * Math.cos(angle))
          const ringLon = this.receiver.lon * Math.PI / 180 + Math.atan2(Math.sin(angle) * Math.sin(angular) * Math.cos(latitude), Math.cos(angular) - Math.sin(latitude) * Math.sin(ringLat))
          coordinates.push(ringLon * 180 / Math.PI, ringLat * 180 / Math.PI)
        }
        this._receiverEntities.push(this._viewer.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(coordinates), width: 1, material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString('#73a2a5').withAlpha(0.24), dashLength: 10 }), show: this.coverage }}))
      })
      this._viewer.scene.requestRender()
    },
    syncAircraft() {
      if (!this._viewer || !this._entities) return
      const C = this._C
      const active = new Set()
      this.aircraft.filter(target => target.hasPosition).forEach(target => {
        active.add(target.icao)
        const selected = target.icao === this.selectedId
        const color = target.emergency ? '#ed7370' : selected ? '#f3ac61' : target.onGround ? '#94ada8' : '#8bc6ed'
        let entity = this._entities.get(target.icao)
        if (!entity) {
          entity = this._viewer.entities.add({
            id: `aircraft-${target.icao}`,
            billboard: { image: planeImage(color), width: 28, height: 28, alignedAxis: C.Cartesian3.UNIT_Z, disableDepthTestDistance: Infinity },
            label: { font: '11px "Consolas", monospace', pixelOffset: new C.Cartesian2(0, 27), showBackground: true, backgroundColor: C.Color.fromCssColorString('#10202c').withAlpha(0.85), backgroundPadding: new C.Cartesian2(5, 3), disableDepthTestDistance: Infinity },
            polyline: { width: 1.2 }
          })
          this._entities.set(target.icao, entity)
        }
        entity.position = C.Cartesian3.fromDegrees(target.longitude, target.latitude, 0)
        entity.billboard.image = planeImage(color)
        entity.billboard.rotation = -C.Math.toRadians(target.heading || 0)
        entity.billboard.scale = selected ? 1.3 : 1
        entity.label.text = `${target.callsign}${selected && target.altitude != null ? '\n' + Math.round(target.altitude / 100) + ' · ' + (target.speed == null ? '—' : Math.round(target.speed)) : ''}`
        entity.label.fillColor = C.Color.fromCssColorString(color)
        entity.label.show = this.labels || selected
        const trail = this.trails[target.icao] || []
        entity.polyline.positions = trail.length > 1 ? C.Cartesian3.fromDegreesArray([].concat(...trail)) : []
        entity.polyline.material = C.Color.fromCssColorString(color).withAlpha(selected ? 0.85 : 0.22)
        entity.polyline.width = selected ? 2 : 1
        entity.polyline.show = this.tracks && trail.length > 1
      })
      this._entities.forEach((entity, id) => {
        if (!active.has(id)) { this._viewer.entities.remove(entity); this._entities.delete(id) }
      })
      if (this._following) this.focus(this.selectedId, false)
      this._viewer.scene.requestRender()
    },
    reset() {
      if (!this._viewer) return
      this._following = false
      const C = this._C
      const bounds = Number.isFinite(this.receiver.lon) && Number.isFinite(this.receiver.lat)
        ? [this.receiver.lon - 2.25, this.receiver.lat - 1.65, this.receiver.lon + 2.25, this.receiver.lat + 1.65]
        : [70, 10, 140, 55]
      this._viewer.camera.setView({ destination: C.Rectangle.fromDegrees(...bounds) })
      this._viewer.scene.requestRender()
    },
    zoom(direction) {
      if (!this._viewer) return
      this._following = false
      const distance = this._viewer.camera.positionCartographic.height * 0.32
      if (direction > 0) this._viewer.camera.zoomIn(distance)
      else this._viewer.camera.zoomOut(distance)
      this._viewer.scene.requestRender()
    },
    setMode(mode) {
      if (!this._viewer) return
      if (mode === '3D') this._viewer.scene.morphTo3D(0.6)
      else this._viewer.scene.morphTo2D(0.6)
      this._viewer.scene.requestRender()
    },
    focus(id, animate = true) {
      const target = this.aircraft.find(plane => plane.icao === id && plane.hasPosition)
      if (!target || !this._viewer) return
      const C = this._C
      const destination = C.Cartesian3.fromDegrees(target.longitude, target.latitude, Math.max(80000, this._viewer.camera.positionCartographic.height))
      if (animate) this._viewer.camera.flyTo({ destination, duration: 0.7 })
      else this._viewer.camera.setView({ destination })
    },
    follow(enabled) { this._following = enabled; if (enabled) this.focus(this.selectedId) }
  }
}
</script>

<style scoped>
.cesium-map, .cesium-canvas { width: 100%; height: 100%; position: absolute; inset: 0; }
.cesium-map { background: #14212d; }
.map-message { position: absolute; z-index: 2; left: 50%; top: 50%; transform: translate(-50%, -50%); color: #c4d3df; font-size: 13px; background: #1b2a38; padding: 16px 22px; border: 1px solid #354656; border-radius: 4px; }
.map-message button { margin-left: 16px; background: transparent; border: 0; color: #8bc6ed; cursor: pointer; }
.map-basemap-status { position: absolute; top: 47px; left: 10px; max-width: calc(100% - 24px); padding: 6px 10px; color: #c4d3df; background: rgba(16, 31, 43, .88); border: 1px solid #354656; font-size: 11px; pointer-events: none; }
.tile-notice { position: absolute; top: 81px; left: 10px; max-width: calc(100% - 48px); padding: 8px 12px; font-size: 11px; color: #dcb685; background: #1a2733; border: 1px solid #544935; pointer-events: none; }
.google-attribution { position: absolute; bottom: 65px; left: 10px; padding: 10px 0 5px; pointer-events: none; z-index: 3; }
.google-attribution img { display: block; height: 19px; width: auto; }
</style>
