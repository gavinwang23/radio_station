import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { createSnapshotService } from '../src/modules/adsb/snapshot-service.js';

test('snapshot never fetches or returns demo aircraft if receiver is unconfigured', async () => {
  const service = createSnapshotService({ config: loadConfig({}), fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(service.snapshot(), { code: 'ADSB_SOURCE_UNCONFIGURED' });
});

test('snapshot retains modern dump1090 fields and wraps legacy arrays', async () => {
  const modern = { now: 1000, messages: 72, aircraft: [{ hex: 'a123bc', flight: 'TEST123 ', lat: 30, lon: 121, altitude: 10000, seen: 0 }] };
  for (const [input, expected] of [[modern, modern], [modern.aircraft, { aircraft: modern.aircraft }]]) {
    const service = createSnapshotService({ config: loadConfig({ ADSB_SOURCE_URL: 'http://127.0.0.1:8080/data/aircraft.json' }), fetchImpl: async () => new Response(JSON.stringify(input), { headers: { 'content-type': 'application/json' } }) });
    assert.deepEqual(await service.snapshot(), expected);
  }
});

test('malformed payload and upstream failures use explicit receiver error codes', async () => {
  for (const [response, code] of [[new Response('{broken'), 'ADSB_SOURCE_INVALID'], [new Response('{}'), 'ADSB_SOURCE_INVALID'], [new Response('{"aircraft":[null]}'), 'ADSB_SOURCE_INVALID'], [new Response('{"aircraft":[{"hex":"xxxxxx"}]}'), 'ADSB_SOURCE_INVALID'], [new Response('down', { status: 503 }), 'ADSB_SOURCE_UNAVAILABLE']]) {
    const service = createSnapshotService({ config: loadConfig({ ADSB_SOURCE_URL: 'http://127.0.0.1:8080/data/aircraft.json' }), fetchImpl: async () => response });
    await assert.rejects(service.snapshot(), { code });
  }
});

test('a stalled real HTTP receiver is aborted at the configured timeout', async (t) => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const config = loadConfig({ ADSB_SOURCE_URL: `http://127.0.0.1:${server.address().port}/aircraft.json`, ADSB_SOURCE_TIMEOUT_MS: '50' });
  const service = createSnapshotService({ config });
  await assert.rejects(service.snapshot(), { code: 'ADSB_SOURCE_TIMEOUT' });
});
