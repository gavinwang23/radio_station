import { createImageryLayerManager } from '@/services/map/imagery-layer-manager'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function event() {
  const listeners = new Set()
  return {
    addEventListener(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    raise(error) { [...listeners].forEach(listener => listener(error)) },
    get size() { return listeners.size }
  }
}

function provider(name) {
  return { name, errorEvent: event(), requestImage: () => Promise.resolve({ width: 256 }) }
}

function setup(creators = {}) {
  const offline = provider('offline')
  const layers = []
  const viewer = {
    imageryLayers: {
      add(layer) { layers.push(layer); return layer },
      remove(layer, destroy) {
        const index = layers.indexOf(layer)
        if (index === -1) return false
        layers.splice(index, 1)
        if (destroy) layer.destroy()
        return true
      }
    },
    scene: { requestRender() {} }
  }
  const C = { ImageryLayer: class {
    constructor(imagery) { this.imageryProvider = imagery; this.destroyed = false }
    destroy() { this.destroyed = true }
    isDestroyed() { return this.destroyed }
  } }
  const changes = []
  const errors = []
  const entries = { offline: () => ({ provider: offline }), ...creators }
  const registry = {
    get(id) { return entries[id] && { id, label: id, create: entries[id] } }
  }
  const manager = createImageryLayerManager({ C, viewer, registry, probe: p => p.requestImage(0, 0, 0), onChange: state => changes.push(state), onError: error => errors.push(error) })
  return { manager, viewer, layers, changes, errors, offline }
}

const flush = async() => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('imagery layer lifecycle', () => {
  it('keeps local imagery visible until the online tile probe succeeds', async() => {
    const tile = deferred()
    const online = provider('esri')
    online.requestImage = () => tile.promise
    const state = setup({ 'esri-satellite': () => ({ provider: online }) })
    await state.manager.initialize()
    const switching = state.manager.setBasemap('esri-satellite')
    await flush()
    expect(state.layers.map(layer => layer.imageryProvider.name)).toEqual(['offline'])
    tile.resolve({ width: 256 })
    await switching
    expect(state.layers.map(layer => layer.imageryProvider.name)).toEqual(['offline', 'esri'])
    expect(state.changes[state.changes.length - 1]).toEqual({ id: 'esri-satellite', label: 'esri-satellite', fallback: false })
    state.manager.destroy()
  })

  it('does not let an old asynchronous provider replace the latest selection', async() => {
    const old = deferred()
    let disposed = false
    const state = setup({ dark: () => old.promise, 'esri-satellite': () => ({ provider: provider('esri') }) })
    await state.manager.initialize()
    const previous = state.manager.setBasemap('dark')
    await flush()
    await state.manager.setBasemap('esri-satellite')
    old.resolve({ provider: provider('old'), dispose: () => { disposed = true } })
    await previous
    await flush()
    expect(state.layers.map(layer => layer.imageryProvider.name)).toEqual(['offline', 'esri'])
    expect(disposed).toBe(true)
    state.manager.destroy()
  })

  it('falls back to local imagery when both the chosen provider and Esri fail', async() => {
    const unavailable = () => Promise.reject(new Error('network unavailable'))
    const state = setup({ dark: unavailable, 'esri-satellite': unavailable })
    await state.manager.initialize()
    await state.manager.setBasemap('dark')
    expect(state.layers.map(layer => layer.imageryProvider.name)).toEqual(['offline'])
    expect(state.changes[state.changes.length - 1]).toEqual({ id: 'offline', label: 'offline', fallback: true })
    expect(state.errors.length).toBe(2)
    state.manager.destroy()
  })

  it('switches once after consecutive errors and removes stale callbacks and resources', async() => {
    const online = provider('esri')
    let disposed = false
    const state = setup({ 'esri-satellite': () => ({ provider: online, dispose: () => { disposed = true } }) })
    await state.manager.initialize()
    await state.manager.setBasemap('esri-satellite')
    const onlineLayer = state.layers[1]
    online.errorEvent.raise(new Error('tile failed'))
    online.errorEvent.raise(new Error('tile failed'))
    expect(state.layers).toHaveLength(2)
    online.errorEvent.raise(new Error('tile failed'))
    await flush()
    expect(state.layers).toHaveLength(1)
    expect(state.errors).toHaveLength(1)
    expect(onlineLayer.destroyed).toBe(true)
    expect(online.errorEvent.size).toBe(0)
    expect(disposed).toBe(true)
    online.errorEvent.raise(new Error('stale tile failed'))
    expect(state.errors).toHaveLength(1)
    state.manager.destroy()
    expect(state.layers).toHaveLength(0)
  })

  it('resets consecutive tile failures after a successful tile', async() => {
    const online = provider('esri')
    const state = setup({ 'esri-satellite': () => ({ provider: online }) })
    await state.manager.initialize()
    await state.manager.setBasemap('esri-satellite')
    online.errorEvent.raise(new Error('tile failed'))
    online.errorEvent.raise(new Error('tile failed'))
    await online.requestImage(0, 0, 0)
    online.errorEvent.raise(new Error('tile failed'))
    expect(state.layers).toHaveLength(2)
    expect(state.errors).toHaveLength(0)
    state.manager.destroy()
  })

  it('disposes providers completing after map destruction without creating a layer', async() => {
    const pending = deferred()
    let disposed = false
    const state = setup({ dark: () => pending.promise })
    await state.manager.initialize()
    const switching = state.manager.setBasemap('dark')
    await flush()
    state.manager.destroy()
    pending.resolve({ provider: provider('late'), dispose: () => { disposed = true } })
    await switching
    await flush()
    expect(state.layers).toHaveLength(0)
    expect(disposed).toBe(true)
  })

  it('bounds a hanging tile probe and releases the failed provider before local fallback', async() => {
    jest.useFakeTimers()
    const tile = deferred()
    const online = provider('esri')
    online.requestImage = () => tile.promise
    let disposed = false
    const state = setup({ 'esri-satellite': () => ({ provider: online, dispose: () => { disposed = true } }) })
    await state.manager.initialize()
    const switching = state.manager.setBasemap('esri-satellite')
    await flush()
    jest.advanceTimersByTime(10000)
    await switching
    expect(state.layers.map(layer => layer.imageryProvider.name)).toEqual(['offline'])
    expect(state.changes[state.changes.length - 1].fallback).toBe(true)
    expect(state.errors[0]).toContain('超时')
    expect(disposed).toBe(true)
    state.manager.destroy()
    jest.clearAllTimers()
    jest.useRealTimers()
  })
})
