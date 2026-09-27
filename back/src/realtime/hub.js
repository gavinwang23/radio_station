import { WebSocket, WebSocketServer } from 'ws';

export function createRealtimeHub({ server, sourceService, path = '/api/v1/stream', allowedOrigins = [], heartbeatMs = 30000, maxBufferedBytes = 1024 * 1024, maxClients = 64 }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  let closed = false;
  let closing;

  function send(client, payload) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > maxBufferedBytes || Buffer.byteLength(payload) > maxBufferedBytes) {
      client.terminate();
      return;
    }
    client.send(payload, error => { if (error) client.terminate(); });
  }

  function publish(type, data) {
    if (closed) return;
    const payload = JSON.stringify({ type, data });
    for (const client of wss.clients) send(client, payload);
  }

  const unsubscribe = sourceService.subscribe(data => publish('adsb.snapshot', data));

  function reject(socket, status, text) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function onUpgrade(request, socket, head) {
    socket.on('error', () => socket.destroy());
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { reject(socket, 400, 'Bad Request'); return; }
    if (closed || pathname !== path) { reject(socket, 404, 'Not Found'); return; }
    const origin = request.headers.origin;
    if (origin) {
      let sameHost = false;
      try {
        const value = new URL(origin);
        sameHost = ['http:', 'https:'].includes(value.protocol) && value.host === request.headers.host;
      } catch { /* An invalid Origin is denied. */ }
      if (!sameHost && !allowedOrigins.includes(origin)) { reject(socket, 403, 'Forbidden'); return; }
    }
    if (wss.clients.size >= maxClients) { reject(socket, 503, 'Service Unavailable'); return; }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
  }

  server.on('upgrade', onUpgrade);
  wss.on('connection', client => {
    client.alive = true;
    client.on('pong', () => { client.alive = true; });
    client.on('error', () => client.terminate());
    client.on('message', () => client.close(1008, 'Receive-only stream'));
    const data = sourceService.streamState ? sourceService.streamState() : { snapshot: sourceService.snapshot(), status: sourceService.getStatus() };
    send(client, JSON.stringify({ type: 'adsb.snapshot', data }));
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.alive) { client.terminate(); continue; }
      client.alive = false;
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  function close() {
    if (closing) return closing;
    closed = true;
    clearInterval(heartbeat);
    server.off('upgrade', onUpgrade);
    unsubscribe();
    for (const client of wss.clients) client.terminate();
    closing = new Promise(resolve => wss.close(resolve));
    return closing;
  }

  return { publish, close };
}
