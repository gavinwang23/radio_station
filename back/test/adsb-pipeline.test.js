import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLiveAdsbService } from '../src/modules/adsb/live-service.js';
import { createRealtimeHub } from '../src/realtime/hub.js';

test('saved HTTP source feeds raw TCP frames through decoding and websocket snapshots', { timeout: 5000 }, async t => {
  let stored = null;
  let peer;
  const peers = new Set();
  const receiver = net.createServer(socket => {
    peer = socket;
    peers.add(socket);
    socket.on('close', () => peers.delete(socket));
  });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const repository = {
    get: async () => stored ? structuredClone(stored) : null,
    save: async (module, source) => {
      assert.equal(module, 'adsb');
      stored = structuredClone(source);
      return structuredClone(stored);
    },
  };
  const service = createLiveAdsbService({ repository, snapshotIntervalMs: 20, reconnectDelayMs: 1000 });
  const app = createApp({ config: loadConfig({}), liveService: service });
  const server = app.listen(0, '127.0.0.1');
  const hub = createRealtimeHub({ server, sourceService: service });
  await once(server, 'listening');
  t.after(async () => {
    service.close();
    await hub.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const socket of peers) socket.destroy();
    await new Promise(resolve => receiver.close(resolve));
  });
  await service.initialize();
  const base = `http://127.0.0.1:${server.address().port}`;
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/v1/stream');
  t.after(() => socket.terminate());
  const events = [];
  socket.on('message', raw => events.push(JSON.parse(raw)));
  await once(socket, 'open');
  const waitFor = async predicate => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'The TCP/decoder/WebSocket pipeline did not deliver the expected event');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  await waitFor(() => events.length > 0);
  assert.equal(events[0].data.status.state, 'unconfigured');
  assert.equal(events[0].data.persisted, false);
  assert.equal(typeof events[0].data.revision, 'number');
  const source = { name: 'Fixture receiver', host: '127.0.0.1', port: receiver.address().port, enabled: true, station: { name: '', latitude: null, longitude: null } };
  const save = await fetch(`${base}/api/v1/adsb/source`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source) });
  assert.equal(save.status, 200);
  const saved = (await save.json()).data;
  assert.equal(saved.persisted, true);
  assert.ok(saved.revision > events[0].data.revision);
  assert.deepEqual(stored, source);
  await waitFor(() => peer && events.some(event => event.data.status.state === 'waiting'));
  assert.ok(!events.some(event => event.data.status.state === 'connected'));
  // Published even/odd airborne CPR examples, fragmented and coalesced as real TCP may deliver them.
  peer.write('*8D40621D58C382D');
  peer.write('690C8AC2863A7;\n*8D40621D58C386435CC412692AD6;\n');
  await waitFor(() => events.some(event => event.data.snapshot.aircraft.some(aircraft => Number.isFinite(aircraft.lat))));
  const received = events.findLast(event => event.data.snapshot.aircraft.some(aircraft => Number.isFinite(aircraft.lat)));
  const aircraft = received.data.snapshot.aircraft.find(item => item.hex === '40621d');
  assert.equal(received.type, 'adsb.snapshot');
  assert.deepEqual(received.data.source, source);
  assert.equal(received.data.revision, saved.revision);
  assert.equal(received.data.status.state, 'connected');
  assert.equal(aircraft.alt_baro, 38000);
  // Coalesced frames may receive the same millisecond timestamp; either valid
  // parity can be the selected CPR position. Exact parity timing has unit tests.
  const positions = [[52.26578, 3.93891], [52.257202, 3.919373]];
  assert.ok(positions.some(([lat, lon]) => Math.abs(aircraft.lat - lat) < 0.0001 && Math.abs(aircraft.lon - lon) < 0.0001));
  assert.equal((await (await fetch(`${base}/api/v1/adsb/source`)).json()).data.source.port, source.port);
  peer.destroy();
  await waitFor(() => events.some(event => event.data.status.state === 'reconnecting' && event.data.snapshot.aircraft.length === 0));
  assert.deepEqual(service.snapshot().aircraft, []);
});
