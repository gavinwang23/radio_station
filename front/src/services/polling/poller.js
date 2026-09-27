export function createPoller({ load, onData, onError = () => {}, intervalMs = 2000 }) {
  let generation = 0
  let running = false
  let timer = null
  let controller = null

  function stop() {
    running = false
    generation++
    clearTimeout(timer)
    timer = null
    if (controller) controller.abort()
    controller = null
  }

  async function run(token, context) {
    const requestController = typeof AbortController === 'undefined' ? null : new AbortController()
    controller = requestController
    try {
      const data = await load({ signal: requestController && requestController.signal, context })
      if (running && token === generation) await onData(data, context)
    } catch (error) {
      if (running && token === generation) await onError(error, context)
    } finally {
      if (running && token === generation) {
        controller = null
        timer = setTimeout(() => run(token, context), intervalMs)
      }
    }
  }

  return {
    start(context) {
      stop()
      running = true
      return run(generation, context)
    },
    stop,
    isRunning() { return running }
  }
}
