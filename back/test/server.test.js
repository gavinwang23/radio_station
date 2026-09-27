import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('shutdown stops HTTP serving, closes the database, and removes signal listeners', async () => {
  const signals = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  const config = loadConfig({});
  config.server.port = 0;
  const { app, server, shutdown } = startServer(config);
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/health`);
  assert.equal(response.status, 200);
  let closed = false;
  app.locals.database.close = async () => { closed = true; };
  await shutdown('test');
  assert.equal(server.listening, false);
  assert.equal(closed, true);
  assert.equal(process.listenerCount('SIGINT'), signals.int);
  assert.equal(process.listenerCount('SIGTERM'), signals.term);
});

test('an occupied port exits with a useful listen error instead of a null-address crash', { timeout: 5000 }, async t => {
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await new Promise(resolve => blocker.once('listening', resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const port = blocker.address().port;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_NAME: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 1);
  assert.match(stderr, /EADDRINUSE/);
  assert.match(stderr, new RegExp(String(port)));
  assert.doesNotMatch(stderr, /TypeError|reading 'port'/);
  assert.doesNotMatch(stdout, /API listening/);
});
