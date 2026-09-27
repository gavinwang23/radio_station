import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/database/migrations/index.js';
import { createSourceRepository } from '../src/modules/sources/repository.js';

function fixtureDatabase() {
  const calls = [];
  let source;
  let migrated = false;
  return { calls, async execute(sql, values = []) {
    calls.push({ sql, values });
    if (/SELECT.*rs_schema_migrations/s.test(sql)) return [migrated ? [{ id: '001_signal_sources' }] : [], []];
    if (/INSERT IGNORE INTO.*rs_schema_migrations/s.test(sql)) migrated = true;
    if (/INSERT INTO.*signal_sources/s.test(sql)) source = { module: values[0], protocol: values[1], name: values[2], host: values[3], port: values[4], enabled: values[5], station_name: values[6], station_latitude: values[7], station_longitude: values[8] };
    if (/SELECT.*FROM.*signal_sources/s.test(sql)) return [source ? [source] : [], []];
    return [[], []];
  } };
}

test('migration creates only application extension tables and can run repeatedly', async () => {
  const database = fixtureDatabase();
  await migrate(database);
  await migrate(database);
  const createStatements = database.calls.filter(call => /^CREATE TABLE/.test(call.sql));
  assert.ok(createStatements.some(call => call.sql.includes('rs_schema_migrations')));
  assert.ok(createStatements.some(call => call.sql.includes('signal_sources')));
  assert.ok(createStatements.every(call => /IF NOT EXISTS/.test(call.sql)));
  assert.equal(database.calls.filter(call => /INSERT IGNORE INTO.*rs_schema_migrations/s.test(call.sql)).length, 1);
});

test('repository returns no record until saved and restores it from the database', async () => {
  const database = fixtureDatabase();
  const repository = createSourceRepository({ database });
  assert.equal(await repository.get('adsb'), null);
  const saved = await repository.save('adsb', { name: "Airport's receiver", host: 'receiver.local', enabled: true, station: { name: 'Roof', latitude: 31.2, longitude: 121.5 } });
  assert.deepEqual(saved, { name: "Airport's receiver", host: 'receiver.local', port: 30002, enabled: true, station: { name: 'Roof', latitude: 31.2, longitude: 121.5 } });
  assert.deepEqual(await createSourceRepository({ database }).get('adsb'), saved);
  const write = database.calls.find(call => /INSERT INTO.*signal_sources/s.test(call.sql));
  assert.ok(!write.sql.includes("Airport's receiver"));
  assert.equal(write.values[1], 'avr-tcp');
  assert.deepEqual(write.values.slice(2), ["Airport's receiver", 'receiver.local', 30002, 1, 'Roof', 31.2, 121.5]);
});

test('source validation accepts IP addresses and hostnames but rejects URLs and invalid coordinates', async () => {
  const repository = createSourceRepository({ database: fixtureDatabase() });
  for (const host of ['127.0.0.1', 'dump1090', 'feed.example.com', '::1', '2001:db8::12']) {
    assert.equal((await repository.save('adsb', { host })).host, host);
  }
  for (const host of ['http://127.0.0.1', 'tcp://receiver:30002', 'user@receiver', '/tmp/feed', 'host/path', 'host:30002', 'bad host', '999.1.1.1', '-bad.example']) {
    await assert.rejects(repository.save('adsb', { host }), { code: 'INVALID_SOURCE' });
  }
  for (const input of [{ port: 0 }, { port: 65536 }, { port: 1.5 }, { port: '30002' }, { enabled: 'true' }, { station: { latitude: 91 } }, { station: { longitude: -181 } }, { station: { latitude: '31' } }, { protocol: 'http' }]) {
    await assert.rejects(repository.save('adsb', { host: '127.0.0.1', ...input }), { code: 'INVALID_SOURCE' });
  }
});

test('database failures never create an in-memory persisted source and migration can retry', async () => {
  const real = fixtureDatabase();
  let fail = true;
  const database = { execute: (...args) => fail ? Promise.reject(Object.assign(new Error('Database is unavailable'), { code: 'DATABASE_UNAVAILABLE' })) : real.execute(...args) };
  const repository = createSourceRepository({ database });
  await assert.rejects(repository.save('adsb', { host: '127.0.0.1' }), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(repository.migrationStatus().ready, false);
  fail = false;
  assert.equal(await repository.get('adsb'), null);
  assert.equal(repository.migrationStatus().ready, true);
});
