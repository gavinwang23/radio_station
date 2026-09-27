import { createPoller } from '@/services/polling/poller'

const flush = async() => { for (let i = 0; i < 6; i++) await Promise.resolve() }

describe('shared polling lifecycle', () => {
  let poller
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => { if (poller) poller.stop(); jest.clearAllTimers(); jest.useRealTimers() })

  it('ignores a previous load after source switching', async() => {
    const results = []
    let finishOld
    poller = createPoller({ load: ({ context }) => context === 'old' ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve('new snapshot'), onData: value => results.push(value) })
    poller.start('old')
    await poller.start('new')
    finishOld('old snapshot')
    await flush()
    expect(results).toEqual(['new snapshot'])
  })

  it('waits for load completion before starting the next interval', async() => {
    let active = 0
    let maximumActive = 0
    let finish
    poller = createPoller({ intervalMs: 2000, load: () => new Promise(resolve => { active++; maximumActive = Math.max(active, maximumActive); finish = () => { active--; resolve('value') } }), onData() {} })
    poller.start()
    jest.advanceTimersByTime(10000)
    expect(maximumActive).toBe(1)
    finish()
    await flush()
    jest.advanceTimersByTime(2000)
    expect(maximumActive).toBe(1)
    finish()
    await flush()
  })

  it('stops scheduled retries and does not report a stopped load as an error', async() => {
    const errors = []
    let rejectLoad
    poller = createPoller({ load: () => new Promise((resolve, reject) => { rejectLoad = reject }), onData() {}, onError: error => errors.push(error) })
    poller.start()
    poller.stop()
    rejectLoad(new Error('cancelled network'))
    await flush()
    jest.advanceTimersByTime(10000)
    expect(errors).toEqual([])
    expect(poller.isRunning()).toBe(false)
  })
})
