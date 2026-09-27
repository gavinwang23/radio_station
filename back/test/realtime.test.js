import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRealtimeHub } from '../src/realtime/hub.js';

async function fixture(t, options = {}) {
  const server = createServer();
  let subscriber;
  const state = { snapshot: { now: 100, aircraft: [] }, status: { state: 'waiting', connected: true } };
  const service = {
    snapshot: () => state.snapshot, getStatus: () => state.status,
    subscribe: callback => { subscriber = callback; return () => { subscriber = null; }; }
  };
  const hub = createRealtimeHub({ server, sourceService: service, heartbeatMs: 100, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await hub.close(); await new Promise(resolve => server.close(resolve)); });
  return { url: `ws://127.0.0.1:${server.address().port}/api/v1/stream`, emit: value => subscriber(value) };
}

test('a websocket receives the current source state and subsequent decoded snapshots', async t => {
  const { url, emit } = await fixture(t);
  const socket = new WebSocket(url);
  t.after(() => socket.terminate());
  const [initial] = await once(socket, 'message');
  assert.deepEqual(JSON.parse(initial), { type: 'adsb.snapshot', data: { snapshot: { now: 100, aircraft: [] }, status: { state: 'waiting', connected: true } } });
  const next = once(socket, 'message');
  const data = { snapshot: { now: 101, aircraft: [{ hex: '40621d', lat: 52.25, lon: 3.92 }] }, status: { state: 'connected', connected: true } };
  emit(data);
  assert.deepEqual(JSON.parse((await next)[0]), { type: 'adsb.snapshot', data });
});

test('websocket upgrades reject unrelated origins and paths', async t => {
  const { url } = await fixture(t);
  for (const [target, origin, expected] of [[url, 'https://unrelated.example', 403], [url.replace('/stream', '/other'), undefined, 404]]) {
    const socket = new WebSocket(target, { origin });
    t.after(() => socket.terminate());
    const status = await new Promise(resolve => {
      socket.on('error', () => {});
      socket.once('unexpected-response', (req, response) => { response.resume(); req.destroy(); resolve(response.statusCode); });
    });
    assert.equal(status, expected);
  }
});

test('the realtime channel does not accept client messages as receiver commands', async t => {
  const { url } = await fixture(t);
  const socket = new WebSocket(url);
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send('{"host":"private.example","port":30002}');
  assert.equal((await closed)[0], 1008);
});

test('a full realtime hub refuses excess clients and bounds outgoing snapshot size', async t => {
  const { url, emit } = await fixture(t, { maxClients: 1, maxBufferedBytes: 1024 });
  const socket = new WebSocket(url);
  t.after(() => socket.terminate());
  await once(socket, 'message');
  const extra = new WebSocket(url);
  t.after(() => extra.terminate());
  extra.on('error', () => {});
  const status = await new Promise(resolve => extra.once('unexpected-response', (request, response) => {
    response.resume();
    request.destroy();
    resolve(response.statusCode);
  }));
  assert.equal(status, 503);
  const closed = once(socket, 'close');
  emit({ snapshot: { aircraft: [{ flight: 'a'.repeat(2048) }] }, status: { state: 'connected', connected: true } });
  assert.equal((await closed)[0], 1006);
});
