import { withTimeout } from './async-resource'
import { probeImagery } from './imagery-registry'

export function createImageryLayerManager({ C, viewer, registry, onChange = () => {}, onError = () => {}, probe = probeImagery, timeoutMs = 10000, errorThreshold = 3, ...context }) {
  let generation = 0
  let destroyed = false
  let controller
  let offline
  let online
  let initialization
  const disposed = new WeakSet()
  const isCurrent = version => !destroyed && version === generation
  const render = () => viewer.scene.requestRender()
  const publish = (entry, fallback) => onChange({ id: entry.id, label: entry.label, fallback })

  function disposeResource(resource) {
    if (!resource || disposed.has(resource)) return
    disposed.add(resource)
    if (resource.dispose) resource.dispose()
    const provider = resource.provider
    if (provider && provider.destroy && (!provider.isDestroyed || !provider.isDestroyed())) provider.destroy()
  }

  function remove(record) {
    if (!record) return
    if (record.removeError) record.removeError()
    if (record.restoreRequest) record.restoreRequest()
    disposeResource(record.resource)
    const removed = viewer.imageryLayers.remove(record.layer, true)
    if (!removed && (!record.layer.isDestroyed || !record.layer.isDestroyed())) record.layer.destroy()
  }

  function local(fallback = false) {
    if (offline && !destroyed) { publish(offline.entry, fallback); render() }
  }

  async function create(entry, version, signal, fatal) {
    let expired = false
    const creation = Promise.resolve().then(() => entry.create({ C, viewer, signal, ...context, onFatalError: fatal }))
    creation.then(resource => {
      if (expired || !isCurrent(version)) disposeResource(resource)
    }, () => {})
    try {
      return await withTimeout(creation, { signal, timeoutMs })
    } catch (error) {
      expired = true
      throw error
    }
  }

  function monitor(record, version, recover) {
    const provider = record.resource.provider
    let failures = 0
    let recovering = false
    const original = provider.requestImage
    const wrapped = function(...args) {
      const image = original.apply(this, args)
      if (!image) return image
      return Promise.resolve(image).then(value => { failures = 0; return value })
    }
    provider.requestImage = wrapped
    record.restoreRequest = () => { if (provider.requestImage === wrapped) provider.requestImage = original }
    if (provider.errorEvent) {
      record.removeError = provider.errorEvent.addEventListener(error => {
        if (!isCurrent(version) || online !== record || recovering) return
        failures++
        if (failures >= errorThreshold) {
          recovering = true
          // Let Cesium finish reporting the tile error before destroying its layer.
          Promise.resolve().then(() => recover(error))
        }
      })
    }
  }

  async function attempt(ids, requested, version, signal) {
    for (let index = 0; index < ids.length && isCurrent(version); index++) {
      const id = ids[index]
      if (id === 'offline') { local(true); return }
      const entry = registry.get(id)
      let resource
      let record
      const recover = error => {
        if (!isCurrent(version) || online !== record) return
        onError(`${entry.label}不可用：${error.message || '瓦片请求连续失败'}，正在使用备用底图`)
        remove(online)
        online = null
        local(true)
        attempt(ids.slice(index + 1), requested, version, signal)
      }
      try {
        if (!entry) throw new Error(`未知底图：${id}`)
        resource = await create(entry, version, signal, recover)
        if (!isCurrent(version)) { disposeResource(resource); return }
        await withTimeout(probe(resource.provider, { C, viewer, signal }), { signal, timeoutMs, message: `${entry.label}瓦片加载超时` })
        if (!isCurrent(version)) { disposeResource(resource); return }
        const layer = new C.ImageryLayer(resource.provider)
        record = { entry, resource, layer }
        viewer.imageryLayers.add(layer)
        online = record
        monitor(record, version, recover)
        if (resource.attach) resource.attach()
        publish(entry, id !== requested)
        render()
        return
      } catch (error) {
        if (record) { remove(record); if (online === record) online = null } else disposeResource(resource)
        if (!isCurrent(version) || error.name === 'AbortError') return
        onError(`${entry ? entry.label : id}不可用：${error.message || '加载失败'}，正在使用备用底图`)
      }
    }
    if (isCurrent(version)) local(true)
  }

  function initialize() {
    if (initialization) return initialization
    const version = generation
    const entry = registry.get('offline')
    initialization = create(entry, version).then(resource => {
      if (!isCurrent(version)) { disposeResource(resource); return }
      const layer = new C.ImageryLayer(resource.provider)
      viewer.imageryLayers.add(layer)
      offline = { entry, resource, layer }
      local(false)
    })
    return initialization
  }

  async function setBasemap(id) {
    await initialize()
    if (destroyed) return
    const version = ++generation
    if (controller) controller.abort()
    controller = typeof AbortController === 'undefined' ? null : new AbortController()
    remove(online)
    online = null
    local(false)
    if (id === 'offline') return
    const candidates = id === 'esri-satellite' ? [id, 'offline'] : [id, 'esri-satellite', 'offline']
    await attempt(candidates, id, version, controller && controller.signal)
  }

  function destroy() {
    if (destroyed) return
    destroyed = true
    generation++
    if (controller) controller.abort()
    remove(online)
    remove(offline)
    online = null
    offline = null
  }

  return { initialize, setBasemap, destroy }
}
