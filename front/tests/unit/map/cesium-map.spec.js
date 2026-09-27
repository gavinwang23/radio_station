import CesiumMap from '@/components/Airspace/CesiumMap.vue'

describe('map updates during initialization', () => {
  it('ignores aircraft prop updates while the viewer is waiting for its first local provider', () => {
    const partialMap = { _viewer: {}, _C: {}, aircraft: [] }
    expect(() => CesiumMap.methods.syncAircraft.call(partialMap)).not.toThrow()
  })
})
