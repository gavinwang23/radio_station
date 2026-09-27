import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('defaults leave database and receiver unconfigured', () => {
  const config = loadConfig({});
  assert.deepEqual(config.server, { host: '127.0.0.1', port: 3000, corsOrigins: ['http://localhost:9528', 'http://127.0.0.1:9528', 'http://localhost:9529', 'http://127.0.0.1:9529'] });
  assert.equal(config.database.name, '');
  assert.equal(config.database.queryTimeoutMs, 5000);
  assert.equal(config.adsb.sourceUrl, '');
  assert.deepEqual(config.adsb.columnMapping, { icao: 'icao' });
  assert.equal(config.maps.googleApiBaseUrl, 'https://tile.googleapis.com');
});

test('Google Maps base URL accepts proxy prefixes and normalizes trailing slashes', () => {
  for (const [value, expected] of [
    ['', 'https://tile.googleapis.com'],
    ['   ', 'https://tile.googleapis.com'],
    [' https://maps.example/google/tiles/// ', 'https://maps.example/google/tiles'],
    ['http://127.0.0.1:8080/google', 'http://127.0.0.1:8080/google'],
  ]) {
    assert.equal(loadConfig({ GOOGLE_MAPS_API_BASE_URL: value }).maps.googleApiBaseUrl, expected);
  }
});

test('Google Maps base URL rejects invalid schemes, credentials, query strings and fragments', () => {
  for (const value of [
    'not-a-url',
    'file:///tiles',
    'ftp://maps.example/tiles',
    'https://user:secret@maps.example/tiles',
    'https://@maps.example/tiles',
    'https:\\@maps.example/tiles',
    'https:/@maps.example/tiles',
    'https:////@maps.example/tiles',
    'https:maps.example/tiles',
    'https://maps.example/tiles?key=private',
    'https://maps.example/tiles?',
    'https://maps.example/tiles#fragment',
    'https://maps.example/tiles#',
  ]) {
    assert.throws(() => loadConfig({ GOOGLE_MAPS_API_BASE_URL: value }), /GOOGLE_MAPS_API_BASE_URL/);
  }
});

test('database query deadline accepts an override and rejects invalid bounds', () => {
  assert.equal(loadConfig({ DB_QUERY_TIMEOUT_MS: '2500' }).database.queryTimeoutMs, 2500);
  for (const value of ['0', '120001', 'forever', '1.5']) assert.throws(() => loadConfig({ DB_QUERY_TIMEOUT_MS: value }));
});

test('loads separate station/database/maps configuration without coercing zero coordinates', () => {
  const config = loadConfig({ DB_NAME: 'aircraft', DB_PORT: '3307', STATION_LATITUDE: '0', STATION_LONGITUDE: '-73.2', STATION_ALTITUDE_METERS: '12', GOOGLE_MAPS_API_KEY: 'server-secret', CORS_ORIGINS: 'http://localhost:8081,https://station.example' });
  assert.equal(config.database.name, 'aircraft');
  assert.equal(config.database.port, 3307);
  assert.equal(config.station.latitude, 0);
  assert.equal(config.station.longitude, -73.2);
  assert.equal(config.maps.googleApiKey, 'server-secret');
  assert.deepEqual(config.server.corsOrigins, ['http://localhost:8081', 'https://station.example']);
});

test('rejects unsafe identifiers and invalid config values before SQL can execute', () => {
  for (const env of [{ PORT: 'not-a-port' }, { PORT: '70000' }, { STATION_LATITUDE: '91' }, { ADSB_TABLE: 'aircraft; DROP TABLE aircraft' }, { ADSB_COLUMN_MAPPING: '{"icao":"hex` OR 1=1"}' }, { ADSB_COLUMN_MAPPING: '{broken' }, { ADSB_COLUMN_MAPPING: '{"secret":"password"}' }, { ADSB_SOURCE_URL: 'file:///etc/passwd' }, { ADSB_SOURCE_URL: 'https://user:pass@example.com' }]) {
    assert.throws(() => loadConfig(env));
  }
});
