import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createLiveAdsbService } from '../src/modules/adsb/live-service.js';

const CALLSIGN = '8D4840D6202CC371C32CE0576098';
const source = overrides => ({ name: 'Test receiver', host: '127.0.0.1', port: 30002, enabled: true, station: { name: '', latitude: null, longitude: null }, ...overrides });
function repositoryFixture(initial = null) {
  let stored = initial;
  let failure;
  return {
    fail(error) { failure = error; },
    async get() { if (failure) throw failure; return stored ? structuredClone(stored) : null; },
    async save(module, input) { if (failure) throw failure; stored = structuredClone(input); return structuredClone(stored); },
  };
}
async function waitFor(predicate, timeout = 2000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) assert.fail('Timed out waiting for live ADS-B state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function fixture(t, listener) {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); listener(socket); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}

test('an empty database is unconfigured and its editable defaults are not marked persisted', async t => {
  const service = createLiveAdsbService({ repository: repositoryFixture() });
  t.after(() => service.close());
  await service.initialize();
  const result = await service.getSource();
  assert.equal(result.persisted, false);
  assert.equal(result.source.host, '127.0.0.1');
  assert.equal(result.source.port, 30002);
  assert.equal(result.source.enabled, false);
  assert.equal(result.status.state, 'unconfigured');
  assert.deepEqual(service.snapshot().aircraft, []);
});

test('persisted TCP source restores automatically and split frames feed the real decoder', async t => {
  let peer;
  const port = await fixture(t, socket => { peer = socket; });
  const service = createLiveAdsbService({ repository: repositoryFixture(source({ port })), snapshotIntervalMs: 15, reconnectDelayMs: 15 });
  t.after(() => service.close());
  const events = [];
  const unsubscribe = service.subscribe(event => events.push(event));
  await service.initialize();
  await waitFor(() => service.getStatus().state === 'waiting');
  peer.write(`*${CALLSIGN.slice(0, 10)}`);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(service.snapshot().aircraft, []);
  peer.write(`${CALLSIGN.slice(10)};\n*0000;\n*malformed;\n`);
  await waitFor(() => service.getStatus().state === 'connected');
  assert.equal(service.snapshot().aircraft[0].hex, '4840d6');
  assert.equal(service.getStatus().acceptedFrames, 1);
  assert.equal(service.getStatus().framingErrors, 1);
  assert.ok(service.getStatus().lastMessageAt);
  assert.ok(events.some(event => event.status.state === 'connected' && event.snapshot.aircraft.length === 1));
  unsubscribe();
  const count = events.length;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(events.length, count);
  peer.destroy();
  await waitFor(() => service.getStatus().state !== 'connected');
  assert.deepEqual(service.snapshot().aircraft, []);
});

test('save persists before switching and a failed save leaves the active receiver untouched', async t => {
  let firstPeer;
  let secondConnections = 0;
  const firstPort = await fixture(t, socket => { firstPeer = socket; });
  const secondPort = await fixture(t, () => secondConnections++);
  const repository = repositoryFixture(source({ port: firstPort }));
  const service = createLiveAdsbService({ repository });
  t.after(() => service.close());
  await service.initialize();
  await waitFor(() => service.getStatus().state === 'waiting');
  firstPeer.write(`*${CALLSIGN};\n`);
  await waitFor(() => service.snapshot().aircraft.length === 1);
  repository.fail(Object.assign(new Error('Database is unavailable'), { code: 'DATABASE_UNAVAILABLE' }));
  await assert.rejects(service.saveSource(source({ port: secondPort })), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(secondConnections, 0);
  assert.equal(service.getStatus().state, 'connected');
  assert.equal(service.snapshot().aircraft.length, 1);
  repository.fail(null);
  const saved = await service.saveSource(source({ port: secondPort }));
  assert.equal(saved.persisted, true);
  assert.deepEqual(service.snapshot().aircraft, []);
  await waitFor(() => secondConnections === 1);
  const disabled = await service.saveSource(source({ port: secondPort, enabled: false }));
  assert.equal(disabled.status.state, 'disabled');
  assert.deepEqual(service.snapshot().aircraft, []);
});

test('database startup failure is visible without rejecting initialization, but source GET rejects', async t => {
  const repository = repositoryFixture();
  repository.fail(Object.assign(new Error('Database is unavailable'), { code: 'DATABASE_UNAVAILABLE' }));
  const service = createLiveAdsbService({ repository });
  t.after(() => service.close());
  await service.initialize();
  assert.equal(service.getStatus().state, 'error');
  assert.equal(service.getStatus().connected, false);
  await assert.rejects(service.getSource(), { code: 'DATABASE_UNAVAILABLE' });
});

test('closing during initialization prevents a late database read from starting TCP', async t => {
  let connections = 0;
  const port = await fixture(t, () => connections++);
  let resolveRead;
  const repository = { get: () => new Promise(resolve => { resolveRead = resolve; }) };
  const service = createLiveAdsbService({ repository });
  const pending = service.initialize();
  service.close();
  resolveRead(source({ port }));
  await pending;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(connections, 0);
  assert.equal(service.getStatus().connected, false);
});

test('database failure and recovery immediately reach source-state subscribers', async t => {
  const repository = repositoryFixture(source({ enabled: false }));
  const service = createLiveAdsbService({ repository, snapshotIntervalMs: 60000 });
  t.after(() => service.close());
  await service.initialize();
  const events = [];
  service.subscribe(event => events.push(event));
  repository.fail(Object.assign(new Error('private database details'), { code: 'DATABASE_UNAVAILABLE' }));
  await assert.rejects(service.getSource(), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(events.at(-1).status.databaseError.code, 'DATABASE_UNAVAILABLE');
  assert.ok(!JSON.stringify(events).includes('private database details'));
  repository.fail(null);
  await service.getSource();
  assert.equal(events.at(-1).status.databaseError, null);
  assert.equal(events.at(-1).status.state, 'disabled');
});

test('an older startup read cannot overwrite a source saved while initialization was pending', async t => {
  let connections = 0;
  const port = await fixture(t, () => connections++);
  let resolveRead;
  const repository = { get: () => new Promise(resolve => { resolveRead = resolve; }), save: async (module, saved) => saved };
  const service = createLiveAdsbService({ repository });
  t.after(() => service.close());
  const initializing = service.initialize();
  const saved = await service.saveSource(source({ port, enabled: false }));
  assert.equal(saved.status.state, 'disabled');
  resolveRead(source({ port, enabled: true }));
  await initializing;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(connections, 0);
  assert.equal(service.getStatus().state, 'disabled');
});

test('valid-message expiry returns a heartbeat-only TCP link to waiting and a new valid frame recovers it', async t => {
  let peer;
  let connections = 0;
  const port = await fixture(t, socket => {
    peer = socket;
    connections++;
    const heartbeat = setInterval(() => socket.write('*0000;\n*8D4840D6202CC371C32CE0576099;\n*malformed;\n'), 10);
    socket.on('close', () => clearInterval(heartbeat));
  });
  const service = createLiveAdsbService({ repository: repositoryFixture(source({ port })), validMessageTimeoutMs: 40, idleTimeoutMs: 200, snapshotIntervalMs: 60000 });
  t.after(() => service.close());
  const events = [];
  service.subscribe(event => events.push(event));
  await service.initialize();
  await waitFor(() => service.getStatus().state === 'waiting');
  peer.write(`*${CALLSIGN};\n`);
  await waitFor(() => service.getStatus().state === 'connected');
  const lastMessageAt = service.getStatus().lastMessageAt;
  await new Promise(resolve => setTimeout(resolve, 80));
  const expired = service.getStatus();
  assert.equal(expired.state, 'waiting');
  assert.equal(expired.connected, true);
  assert.equal(expired.lastMessageAt, lastMessageAt);
  assert.ok(expired.lastDataAt > lastMessageAt);
  assert.ok(expired.lastMessageAgeMs >= 40);
  assert.equal(expired.acceptedFrames, 1);
  assert.ok(expired.ignoredFrames > 0);
  assert.ok(expired.framingErrors > 0);
  assert.equal(connections, 1);
  assert.equal(expired.reconnects, 0);
  assert.equal(events.at(-1).status.state, 'waiting');
  peer.write(`*${CALLSIGN};\n`);
  await waitFor(() => service.getStatus().state === 'connected');
  assert.equal(service.getStatus().acceptedFrames, 2);
  assert.ok(service.getStatus().lastMessageAt > lastMessageAt);
});

test('source saves update subscription configuration and revision without exposing mutable source state', async t => {
  const service = createLiveAdsbService({ repository: repositoryFixture(source({ name: 'First', enabled: false })) });
  t.after(() => service.close());
  await service.initialize();
  const events = [];
  service.subscribe(event => events.push(event));
  const initialRevision = events[0].revision;
  assert.equal(events[0].source.name, 'First');
  assert.equal(events[0].persisted, true);
  await service.saveSource(source({ name: 'Second', enabled: false, station: { name: 'Roof', latitude: 31.2, longitude: 121.5 } }));
  const update = events.at(-1);
  assert.equal(update.source.name, 'Second');
  assert.equal(update.source.station.latitude, 31.2);
  assert.ok(update.revision > initialRevision);
  update.source.station.latitude = 0;
  assert.equal(service.streamState().source.station.latitude, 31.2);
  assert.deepEqual(service.streamState().snapshot.aircraft, []);
});

test('startup database failure retries with bounded delay and restores the saved real TCP receiver', async t => {
  let connections = 0;
  const port = await fixture(t, () => connections++);
  let available = false;
  let reads = 0;
  const repository = { async get() {
    reads++;
    if (!available) throw Object.assign(new Error('Database is unavailable'), { code: 'DATABASE_UNAVAILABLE' });
    return source({ port });
  } };
  const service = createLiveAdsbService({ repository, initializationRetryDelayMs: 15, maxInitializationRetryDelayMs: 30 });
  t.after(() => service.close());
  await service.initialize();
  assert.equal(service.getStatus().state, 'error');
  available = true;
  await waitFor(() => service.getStatus().state === 'waiting');
  assert.equal(connections, 1);
  assert.equal(reads, 2);
  assert.equal(service.getStatus().databaseError, null);
});

test('close and successful source save cancel pending startup database retries', async t => {
  const unavailable = Object.assign(new Error('Database is unavailable'), { code: 'DATABASE_UNAVAILABLE' });
  let reads = 0;
  const repository = { get: async () => { reads++; throw unavailable; }, save: async (module, saved) => saved };
  const service = createLiveAdsbService({ repository, initializationRetryDelayMs: 20 });
  t.after(() => service.close());
  await service.initialize();
  await service.saveSource(source({ enabled: false }));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(reads, 1);
  assert.equal(service.getStatus().state, 'disabled');
  const second = createLiveAdsbService({ repository, initializationRetryDelayMs: 20 });
  await second.initialize();
  second.close();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(reads, 2);
  assert.equal(second.getStatus().state, 'disabled');
});

test('an in-flight startup retry cannot reactivate an older source after a successful save', async t => {
  let connections = 0;
  const port = await fixture(t, () => connections++);
  let reads = 0;
  let resolveRetry;
  const repository = {
    get() {
      reads++;
      if (reads === 1) return Promise.reject(Object.assign(new Error('Database is unavailable'), { code: 'DATABASE_UNAVAILABLE' }));
      return new Promise(resolve => { resolveRetry = resolve; });
    },
    save: async (module, saved) => saved,
  };
  const service = createLiveAdsbService({ repository, initializationRetryDelayMs: 10 });
  t.after(() => service.close());
  await service.initialize();
  await waitFor(() => reads === 2);
  const saved = await service.saveSource(source({ port, enabled: false }));
  resolveRetry(source({ port, enabled: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.getStatus().state, 'disabled');
  assert.equal(service.streamState().revision, saved.revision);
  assert.equal(connections, 0);
});
