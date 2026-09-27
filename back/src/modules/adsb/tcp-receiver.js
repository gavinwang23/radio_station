import { Socket } from 'node:net';

const NETWORK_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);

export function createTcpReceiver({
  onData = () => {}, onState = () => {}, onReset = () => {},
  socketFactory = () => new Socket(), connectTimeoutMs = 5000, idleTimeoutMs = 30000,
  validMessageTimeoutMs = 15000, reconnectDelayMs = 1000, maxReconnectDelayMs = 30000,
} = {}) {
  let socket;
  let source;
  let generation = 0;
  let closed = false;
  let connectTimer;
  let idleTimer;
  let validMessageTimer;
  let retryTimer;
  let retryAttempt = 0;
  let status = { state: 'unconfigured', message: 'ADS-B source is not configured', connected: false, lastMessageAt: null, lastDataAt: null, lastError: null, receivedBytes: 0, receivedChunks: 0, reconnects: 0 };
  const getStatus = () => ({ ...status });
  function setState(state, message, additions = {}) {
    status = { ...status, ...additions, state, message };
    onState(getStatus());
  }
  function clearTimers() {
    clearTimeout(connectTimer); clearTimeout(idleTimer); clearTimeout(validMessageTimer); clearTimeout(retryTimer);
    connectTimer = idleTimer = validMessageTimer = retryTimer = undefined;
  }
  function armValidMessageDeadline(delay = validMessageTimeoutMs) {
    if (validMessageTimer) return;
    const ownGeneration = generation;
    const current = socket;
    validMessageTimer = setTimeout(() => {
      validMessageTimer = undefined;
      if (closed || generation !== ownGeneration || socket !== current || !status.connected) return;
      const remaining = validMessageTimeoutMs - (Date.now() - status.lastMessageAt);
      // Keep one timer for the connection rather than reallocating it for
      // every ADS-B frame. Valid reception timestamps extend the deadline.
      if (remaining > 0) armValidMessageDeadline(remaining);
      else setState('waiting', 'Receiver connected; waiting for fresh valid ADS-B messages');
    }, delay);
    validMessageTimer.unref?.();
  }
  function retire() {
    generation++;
    clearTimers();
    const previous = socket;
    socket = undefined;
    previous?.destroy();
    onReset();
  }
  function connect() {
    if (closed || !source) return;
    clearTimers();
    const ownGeneration = ++generation;
    let disconnected = false;
    let current;
    const active = () => !closed && generation === ownGeneration && socket === current;
    const disconnect = (code, message) => {
      if (!active() || disconnected) return;
      disconnected = true;
      clearTimeout(connectTimer); clearTimeout(idleTimer); clearTimeout(validMessageTimer);
      connectTimer = idleTimer = validMessageTimer = undefined;
      socket = undefined;
      current?.destroy();
      onReset();
      const delay = Math.min(maxReconnectDelayMs, reconnectDelayMs * 2 ** Math.min(retryAttempt++, 10));
      setState('reconnecting', message, { connected: false, lastMessageAt: null, lastError: code, reconnects: status.reconnects + 1 });
      retryTimer = setTimeout(() => { if (!closed && generation === ownGeneration && source) connect(); }, delay);
      retryTimer.unref?.();
    };
    const armIdleDeadline = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => disconnect('IDLE_TIMEOUT', 'Receiver stopped sending data; reconnecting'), idleTimeoutMs);
      idleTimer.unref?.();
    };
    setState('connecting', 'Connecting to ADS-B receiver', { connected: false, lastMessageAt: null });
    try {
      current = socketFactory();
      socket = current;
      current.setNoDelay(true);
      current.on('connect', () => {
        if (!active()) return;
        clearTimeout(connectTimer); connectTimer = undefined;
        retryAttempt = 0;
        armIdleDeadline();
        setState('waiting', 'Receiver connected; waiting for valid ADS-B messages', { connected: true });
      });
      current.on('data', chunk => {
        if (!active() || disconnected) return;
        status.lastDataAt = Date.now();
        status.receivedBytes += chunk.length;
        status.receivedChunks++;
        armIdleDeadline();
        onData(chunk);
      });
      current.on('error', error => disconnect(NETWORK_ERRORS.has(error.code) ? error.code : 'CONNECTION_ERROR', 'Receiver connection failed; reconnecting'));
      current.on('close', () => disconnect('CONNECTION_CLOSED', 'Receiver disconnected; reconnecting'));
      current.on('end', () => disconnect('CONNECTION_CLOSED', 'Receiver disconnected; reconnecting'));
      connectTimer = setTimeout(() => disconnect('CONNECT_TIMEOUT', 'Receiver connection timed out; reconnecting'), connectTimeoutMs);
      connectTimer.unref?.();
      current.connect({ host: source.host, port: source.port });
    } catch (error) {
      disconnect(NETWORK_ERRORS.has(error.code) ? error.code : 'CONNECTION_ERROR', 'Receiver connection failed; reconnecting');
    }
  }
  return {
    getStatus,
    start(endpoint) {
      if (closed) return;
      source = { host: endpoint.host, port: endpoint.port };
      retire();
      retryAttempt = 0;
      status = { ...status, lastMessageAt: null, lastDataAt: null, lastError: null, receivedBytes: 0, receivedChunks: 0, reconnects: 0 };
      connect();
    },
    markMessage(at = Date.now()) {
      if (!socket || !status.connected || closed) return;
      status.lastMessageAt = at;
      armValidMessageDeadline();
      if (status.state !== 'connected') setState('connected', 'Receiving ADS-B messages');
    },
    stop(state = 'disabled', message = 'ADS-B source is disabled') {
      source = undefined;
      retire();
      setState(state, message, { connected: false, lastMessageAt: null, lastDataAt: null });
    },
    close() {
      if (closed) return;
      closed = true;
      source = undefined;
      retire();
      setState('disabled', 'ADS-B receiver is closed', { connected: false, lastMessageAt: null, lastDataAt: null });
    },
  };
}
