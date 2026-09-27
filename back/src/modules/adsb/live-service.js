import { AppError } from '../../lib/errors.js';
import { defaultAdsbSource, normalizeSource } from '../sources/repository.js';
import { AvrParser } from './decoder/avr-parser.js';
import { AdsbTracker } from './decoder/aircraft-tracker.js';
import { createTcpReceiver } from './tcp-receiver.js';

export function createLiveAdsbService({
  repository, tracker = new AdsbTracker(), snapshotIntervalMs = 1000,
  connectTimeoutMs = 5000, idleTimeoutMs = 30000, reconnectDelayMs = 1000,
  validMessageTimeoutMs = 15000, maxReconnectDelayMs = 30000, socketFactory, maxBufferBytes = 8192,
  initializationRetryDelayMs = 1000, maxInitializationRetryDelayMs = 30000,
} = {}) {
  let source = defaultAdsbSource();
  let persisted = false;
  let initialized = false;
  let initializing;
  let closed = false;
  let revision = 0;
  let interval;
  let initializationRetryTimer;
  let initializationRetryAttempt = 0;
  let saving = Promise.resolve();
  let databaseError = null;
  let metrics = { framesReceived: 0, acceptedFrames: 0, ignoredFrames: 0, framingErrors: 0 };
  const listeners = new Set();
  const snapshot = () => tracker.snapshot(Date.now());
  const getStatus = () => {
    const status = receiver.getStatus();
    const now = Date.now();
    return { ...status, ...metrics,
      lastDataAgeMs: status.lastDataAt === null ? null : Math.max(0, now - status.lastDataAt),
      lastMessageAgeMs: status.lastMessageAt === null ? null : Math.max(0, now - status.lastMessageAt),
      databaseError: databaseError ? { ...databaseError } : null,
    };
  };
  function emit() {
    if (closed || !listeners.size) return;
    const event = streamState();
    for (const listener of listeners) {
      try { listener(event); } catch { /* A disconnected consumer cannot interrupt reception. */ }
    }
  }
  const parser = new AvrParser({
    maxBufferBytes,
    onFrame(hex) {
      if (closed) return;
      metrics.framesReceived++;
      const now = Date.now();
      if (tracker.ingest(hex, now)) {
        metrics.acceptedFrames++;
        receiver.markMessage(now);
      } else metrics.ignoredFrames++;
    },
    onInvalid() { metrics.framingErrors++; },
  });
  const receiver = createTcpReceiver({
    socketFactory, connectTimeoutMs, idleTimeoutMs, validMessageTimeoutMs, reconnectDelayMs, maxReconnectDelayMs,
    onData: chunk => parser.push(chunk),
    onReset() { parser.reset(); tracker.clear(); },
    onState: emit,
  });
  function startInterval() {
    if (closed || interval) return;
    interval = setInterval(emit, snapshotIntervalMs);
    interval.unref?.();
  }
  function packet() { return { source: structuredClone(source), persisted, status: getStatus(), revision }; }
  function streamState() { return { ...packet(), snapshot: snapshot() }; }
  function cancelInitializationRetry() {
    clearTimeout(initializationRetryTimer);
    initializationRetryTimer = undefined;
    initializationRetryAttempt = 0;
  }
  function scheduleInitializationRetry() {
    if (closed || initialized || initializationRetryTimer) return;
    const ownRevision = revision;
    const delay = Math.min(maxInitializationRetryDelayMs, initializationRetryDelayMs * 2 ** Math.min(initializationRetryAttempt++, 10));
    initializationRetryTimer = setTimeout(() => {
      initializationRetryTimer = undefined;
      if (!closed && !initialized && revision === ownRevision) initialize();
    }, delay);
    initializationRetryTimer.unref?.();
  }
  function apply(record) {
    if (closed) return;
    const next = record ? normalizeSource(record) : defaultAdsbSource();
    const wasPersisted = persisted;
    const recoveringDatabase = Boolean(databaseError);
    const changed = !initialized || wasPersisted !== Boolean(record) || JSON.stringify(next) !== JSON.stringify(source);
    cancelInitializationRetry();
    source = next;
    persisted = Boolean(record);
    initialized = true;
    databaseError = null;
    startInterval();
    if (!changed) { if (recoveringDatabase) emit(); return; }
    revision++;
    metrics = { framesReceived: 0, acceptedFrames: 0, ignoredFrames: 0, framingErrors: 0 };
    if (!persisted) receiver.stop('unconfigured', 'ADS-B source is not configured');
    else if (!source.enabled) receiver.stop('disabled', 'ADS-B source is disabled');
    else receiver.start(source);
  }
  function noteDatabaseError(error) {
    databaseError = { code: error.code ?? 'DATABASE_UNAVAILABLE', message: error.code === 'DATABASE_TIMEOUT' ? 'Database request timed out' : 'Database is unavailable' };
    if (!initialized && !closed) receiver.stop('error', databaseError.message);
    else emit();
  }
  async function initialize() {
    if (closed || initialized) return getStatus();
    if (!initializing) initializing = (async () => {
      const ownRevision = revision;
      try {
        const record = await repository.get('adsb');
        if (!closed && ownRevision === revision) apply(record);
      } catch (error) {
        if (!closed && ownRevision === revision) { noteDatabaseError(error); scheduleInitializationRetry(); }
      }
      finally { initializing = undefined; if (!closed) startInterval(); }
      return getStatus();
    })();
    return initializing;
  }
  return {
    initialize, snapshot, getStatus, streamState,
    async getSource() {
      if (closed) throw new AppError(503, 'ADSB_SERVICE_CLOSED', 'ADS-B receiver is closed');
      const ownRevision = revision;
      try {
        const record = await repository.get('adsb');
        if (!closed && ownRevision === revision) apply(record);
        return packet();
      } catch (error) { if (!closed) noteDatabaseError(error); throw error; }
    },
    saveSource(input) {
      let normalized;
      try { normalized = normalizeSource(input); } catch (error) { return Promise.reject(error); }
      const operation = saving.then(async () => {
        if (closed) throw new AppError(503, 'ADSB_SERVICE_CLOSED', 'ADS-B receiver is closed');
        let record;
        try { record = await repository.save('adsb', normalized); }
        catch (error) { if (!closed) noteDatabaseError(error); throw error; }
        revision++;
        if (!closed) apply(record);
        return packet();
      });
      saving = operation.catch(() => {});
      return operation;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('ADS-B subscriber must be a function');
      if (closed) return () => {};
      listeners.add(listener);
      try { listener(streamState()); } catch { /* Reception does not depend on its consumers. */ }
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      revision++;
      cancelInitializationRetry();
      clearInterval(interval);
      interval = undefined;
      receiver.close();
      listeners.clear();
    },
  };
}
