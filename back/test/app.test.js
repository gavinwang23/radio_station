import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Router } from 'express';
import { sendData } from '../src/lib/response.js';

async function start(t, options = {}) {
  const app = createApp({ config: loadConfig({}), ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health remains available with no DB and preserves a safe request ID', async t => {
  const base = await start(t);
  const response = await fetch(`${base}/api/v1/health`, { headers: { 'x-request-id': 'client-123' } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.meta.requestId, 'client-123');
  assert.equal(response.headers.get('x-request-id'), 'client-123');
  const db = await (await fetch(`${base}/api/v1/database/status`)).json();
  assert.equal(db.data.status, 'unconfigured');
});

test('module discovery exposes extension status and endpoints without leaking config secrets', async t => {
  const base = await start(t, { config: loadConfig({ GOOGLE_MAPS_API_KEY: 'secret-google', DB_PASSWORD: 'secret-db' }) });
  const body = await (await fetch(`${base}/api/v1/modules`)).json();
  assert.ok(Array.isArray(body.data));
  for (const id of ['adsb', 'ais', 'sstv', 'weather', 'satellites']) {
    const module = body.data.find(item => item.id === id);
    assert.ok(module);
    assert.equal(typeof module.label, 'string');
    assert.equal(typeof module.kind, 'string');
    assert.ok(Array.isArray(module.endpoints));
  }
  assert.equal(body.data.find(item => item.id === 'ais').status, 'not_connected');
  assert.ok(!JSON.stringify(body).includes('secret-'));
});

test('validation and 404 errors use the common error envelope', async t => {
  const base = await start(t);
  for (const [path, status, code] of [['/api/v1/adsb/catalog/not-icao', 400, 'INVALID_ICAO'], ['/api/v1/adsb/snapshot', 503, 'ADSB_SOURCE_UNCONFIGURED'], ['/api/v1/no-such-route', 404, 'NOT_FOUND']]) {
    const response = await fetch(base + path);
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, code);
    assert.equal(typeof body.meta.requestId, 'string');
    assert.ok(!JSON.stringify(body).includes('stack'));
  }
});

test('unexpected repository errors do not leak database passwords or SQL', async t => {
  const base = await start(t, { catalogRepository: { schema: async () => { throw new Error('secret-db SELECT * FROM private'); }, lookup: async () => null } });
  const response = await fetch(`${base}/api/v1/adsb/catalog/schema`);
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'An unexpected error occurred');
  assert.ok(!JSON.stringify(body).includes('secret-db'));
});

test('an extension replaces a module placeholder and mounts its own router', async t => {
  const router = Router();
  router.get('/elements', (req, res) => sendData(res, { elements: [], status: 'unconfigured' }));
  const base = await start(t, { modules: [{ id: 'satellites', label: 'Satellite orbits', kind: 'orbits', status: async () => 'unconfigured', router, endpoints: ['/api/v1/satellites/elements'] }] });
  const response = await fetch(`${base}/api/v1/satellites/elements`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { elements: [], status: 'unconfigured' });
  const modules = (await (await fetch(`${base}/api/v1/modules`)).json()).data;
  assert.equal(modules.filter(module => module.id === 'satellites').length, 1);
  assert.equal(modules.find(module => module.id === 'satellites').status, 'unconfigured');
});

test('an unavailable module preserves discovery of the remaining modules', async t => {
  const base = await start(t, { modules: [{ id: 'ais', status: async () => { throw new Error('private receiver failure'); } }] });
  const response = await fetch(`${base}/api/v1/modules`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.find(module => module.id === 'ais').status, 'unavailable');
  assert.equal(body.data.find(module => module.id === 'adsb').status, 'unconfigured');
  assert.equal(body.data.length, 5);
  assert.ok(!JSON.stringify(body).includes('private receiver'));
});

test('the source API reads and persists configuration through the live service', async t => {
  let saved = { name: 'ADS-B', host: 'receiver.local', port: 30002, enabled: false, station: { name: '接收站', latitude: null, longitude: null } };
  const liveService = {
    getStatus: () => ({ state: 'disabled', connected: false }),
    getSource: async () => ({ source: saved, persisted: true, status: { state: 'disabled', connected: false } }),
    saveSource: async source => { saved = source; return { source, persisted: true, status: { state: 'connecting', connected: false } }; },
    snapshot: () => ({ now: 100, aircraft: [] }),
  };
  const base = await start(t, { liveService });
  const read = await fetch(`${base}/api/v1/adsb/source`);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).data.source.host, 'receiver.local');
  const next = { ...saved, enabled: true, host: '192.168.1.8' };
  const write = await fetch(`${base}/api/v1/adsb/source`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
  assert.equal(write.status, 200);
  assert.deepEqual((await write.json()).data.source, next);
  assert.deepEqual((await (await fetch(`${base}/api/v1/adsb/source`)).json()).data.source, next);
});
