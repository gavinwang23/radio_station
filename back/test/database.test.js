import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { createCatalogRepository } from '../src/modules/adsb/catalog-repository.js';

test('missing DB_NAME never creates a pool or makes a network query', async () => {
  const database = createDatabase(loadConfig({}).database, { poolFactory: () => { assert.fail('pool must not be created'); } });
  assert.deepEqual(await database.status(), { status: 'unconfigured', reason: 'DB_NAME is not configured' });
  await assert.rejects(database.execute('SELECT 1'), { code: 'DATABASE_UNCONFIGURED' });
  await database.close();
});

test('database errors reveal a stable status but no internal SQL or credentials', async () => {
  const database = createDatabase(loadConfig({ DB_NAME: 'radio', DB_PASSWORD: 'top-secret' }).database, { poolFactory: () => ({ getConnection: async () => ({ execute: async () => { throw new Error('Access denied top-secret SELECT private'); }, release() {} }), end: async () => {} }) });
  const status = await database.status();
  assert.equal(status.status, 'unavailable');
  assert.ok(!JSON.stringify(status).includes('top-secret'));
  await assert.rejects(database.execute('SELECT private'), { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' });
});

test('query deadline destroys an acquired connection blocked during statement execution', async t => {
  let destroyed = 0;
  let released = 0;
  let executeReject;
  const connection = {
    execute: () => new Promise((resolve, reject) => { executeReject = reject; }),
    release: () => { released++; },
    destroy: () => { destroyed++; executeReject(new Error('socket destroyed')); },
  };
  const pool = { getConnection: async () => connection, execute: (...args) => connection.execute(...args), end: async () => {} };
  const database = createDatabase(loadConfig({ DB_NAME: 'radio', DB_QUERY_TIMEOUT_MS: '20' }).database, { poolFactory: () => pool });
  const watchdog = setTimeout(() => executeReject(new Error('query deadline was not enforced')), 250);
  t.after(() => clearTimeout(watchdog));
  await assert.rejects(database.execute('SELECT private', ['secret']), { code: 'DATABASE_TIMEOUT', message: 'Database request timed out' });
  assert.equal(destroyed, 1);
  assert.equal(released, 0);
  await database.close();
});

test('an expired pool waiter releases a late connection without executing its SQL', async t => {
  let acquire;
  let released = 0;
  let destroyed = 0;
  let executed = 0;
  const connection = {
    execute: async () => { executed++; return [[{ result: 1 }], []]; },
    release: () => { released++; },
    destroy: () => { destroyed++; },
  };
  const pool = {
    getConnection: () => new Promise(resolve => { acquire = resolve; }),
    execute: () => new Promise(() => {}),
    end: async () => {},
  };
  const database = createDatabase(loadConfig({ DB_NAME: 'radio', DB_QUERY_TIMEOUT_MS: '20' }).database, { poolFactory: () => pool });
  let watchdog;
  const safety = new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error('pool deadline was not enforced')), 250); });
  t.after(() => clearTimeout(watchdog));
  await assert.rejects(Promise.race([database.execute('SELECT private'), safety]), { code: 'DATABASE_TIMEOUT' });
  acquire(connection);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executed, 0);
  assert.equal(released, 1);
  assert.equal(destroyed, 0);
});

test('a completed query returns its rows and releases the connection for later requests', async () => {
  let released = 0;
  const rows = [[{ result: 1 }], []];
  const connection = { execute: async (sql, values) => { assert.equal(sql, 'SELECT ?'); assert.deepEqual(values, [1]); return rows; }, release: () => { released++; }, destroy: () => assert.fail('successful connection must not be destroyed') };
  const database = createDatabase(loadConfig({ DB_NAME: 'radio' }).database, { poolFactory: () => ({ getConnection: async () => connection, execute: (...args) => connection.execute(...args), end: async () => {} }) });
  assert.deepEqual(await database.execute('SELECT ?', [1]), rows);
  assert.equal(released, 1);
});

test('catalog reports missing table and missing mapping columns without guessing a schema', async () => {
  const config = loadConfig({ DB_NAME: 'radio', ADSB_TABLE: 'aircraft', ADSB_COLUMN_MAPPING: '{"icao":"hex","registration":"reg"}' });
  const missing = createCatalogRepository({ config, database: { configured: true, execute: async () => [[], []] } });
  assert.equal((await missing.schema()).status, 'table_missing');
  const mismatch = createCatalogRepository({ config, database: { configured: true, execute: async () => [[{ COLUMN_NAME: 'hex', DATA_TYPE: 'varchar', IS_NULLABLE: 'NO' }], []] } });
  assert.equal((await mismatch.schema()).status, 'column_mismatch');
  assert.deepEqual((await mismatch.schema()).missingColumns, ['reg']);
  await assert.rejects(mismatch.lookup('a123bc'), { code: 'CATALOG_COLUMN_MISMATCH' });
});

test('catalog uses configured columns, binds ICAO as a parameter, and exposes logical fields only', async () => {
  const config = loadConfig({ DB_NAME: 'radio', ADSB_TABLE: 'aircraft', ADSB_COLUMN_MAPPING: '{"icao":"hex","registration":"reg","type":"model"}' });
  let lookupSql;
  let lookupValues;
  const database = { configured: true, execute: async (sql, values) => {
    if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_NAME: 'hex' }, { COLUMN_NAME: 'reg' }, { COLUMN_NAME: 'model' }, { COLUMN_NAME: 'private_notes' }], []];
    lookupSql = sql; lookupValues = values;
    return [[{ icao: 'a123bc', registration: 'B-1234', type: 'A320' }], []];
  } };
  const repository = createCatalogRepository({ config, database });
  assert.deepEqual(await repository.lookup('A123BC'), { icao: 'a123bc', registration: 'B-1234', type: 'A320' });
  assert.match(lookupSql, /`hex`.*\?/);
  assert.ok(!lookupSql.includes('a123bc'));
  assert.deepEqual(lookupValues, ['a123bc']);
  await assert.rejects(repository.lookup("' OR 1=1"), { code: 'INVALID_ICAO' });
});
