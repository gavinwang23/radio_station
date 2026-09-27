import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { createTcpReceiver } from '../src/modules/adsb/tcp-receiver.js';

async function waitFor(predicate, timeout = 2000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) assert.fail('Timed out waiting for TCP fixture');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t, listener) {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); listener(socket); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { host: '127.0.0.1', port: server.address().port };
}

test('a real TCP connection waits for accepted messages and clears state before reconnecting', async t => {
  let peer;
  let connections = 0;
  const endpoint = await fixture(t, socket => { peer = socket; connections++; });
  const data = [];
  let resets = 0;
  const receiver = createTcpReceiver({ onData: chunk => data.push(chunk.toString()), onReset: () => resets++, reconnectDelayMs: 15 });
  t.after(() => receiver.close());
  receiver.start(endpoint);
  await waitFor(() => receiver.getStatus().state === 'waiting');
  assert.equal(receiver.getStatus().connected, true);
  assert.equal(receiver.getStatus().lastMessageAt, null);
  peer.write('*8D4062');
  await waitFor(() => data.length);
  assert.equal(receiver.getStatus().state, 'waiting');
  assert.ok(receiver.getStatus().lastDataAt);
  receiver.markMessage(1234);
  assert.equal(receiver.getStatus().state, 'connected');
  assert.equal(receiver.getStatus().lastMessageAt, 1234);
  peer.destroy();
  await waitFor(() => connections === 2 && receiver.getStatus().state === 'waiting');
  assert.equal(receiver.getStatus().lastMessageAt, null);
  assert.ok(resets >= 2);
  assert.equal(receiver.getStatus().reconnects, 1);
});

test('disable destroys the socket and cancels reconnection', async t => {
  let connections = 0;
  const endpoint = await fixture(t, () => connections++);
  const receiver = createTcpReceiver({ reconnectDelayMs: 10, validMessageTimeoutMs: 20 });
  t.after(() => receiver.close());
  receiver.start(endpoint);
  await waitFor(() => receiver.getStatus().state === 'waiting');
  receiver.markMessage();
  receiver.stop('disabled');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(connections, 1);
  assert.equal(receiver.getStatus().state, 'disabled');
  assert.equal(receiver.getStatus().connected, false);
});

test('idle timeout reconnects, while raw unsupported traffic keeps the connection alive', async t => {
  let connections = 0;
  let heartbeat;
  const endpoint = await fixture(t, socket => {
    connections++;
    heartbeat = setInterval(() => socket.write('*0000;\n'), 8);
    socket.on('close', () => clearInterval(heartbeat));
  });
  const receiver = createTcpReceiver({ idleTimeoutMs: 30, reconnectDelayMs: 10 });
  t.after(() => receiver.close());
  receiver.start(endpoint);
  await waitFor(() => receiver.getStatus().state === 'waiting');
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(connections, 1);
  assert.equal(receiver.getStatus().lastMessageAt, null);
  clearInterval(heartbeat);
  await waitFor(() => connections === 2);
  assert.equal(receiver.getStatus().lastError, 'IDLE_TIMEOUT');
});

class PendingSocket extends EventEmitter {
  connect() { return this; }
  setNoDelay() {}
  destroy() { this.emit('close'); }
}

test('a connection deadline schedules a bounded retry and old generations cannot inject data', async t => {
  const sockets = [];
  const chunks = [];
  const receiver = createTcpReceiver({ socketFactory: () => { const socket = new PendingSocket(); sockets.push(socket); return socket; }, onData: chunk => chunks.push(chunk), connectTimeoutMs: 20, reconnectDelayMs: 50 });
  t.after(() => receiver.close());
  receiver.start({ host: '127.0.0.1', port: 30002 });
  await waitFor(() => receiver.getStatus().state === 'reconnecting');
  assert.equal(receiver.getStatus().lastError, 'CONNECT_TIMEOUT');
  assert.equal(sockets.length, 1);
  receiver.start({ host: 'localhost', port: 30003 });
  sockets[0].emit('connect');
  sockets[0].emit('data', Buffer.from('stale'));
  sockets[0].emit('error', Object.assign(new Error('stale failure'), { code: 'ECONNRESET' }));
  assert.equal(receiver.getStatus().state, 'connecting');
  assert.deepEqual(chunks, []);
});

test('valid-message deadlines follow the current source and cannot change state after close', async t => {
  const first = await fixture(t, () => {});
  const second = await fixture(t, () => {});
  const receiver = createTcpReceiver({ validMessageTimeoutMs: 80 });
  t.after(() => receiver.close());
  receiver.start(first);
  await waitFor(() => receiver.getStatus().state === 'waiting');
  receiver.markMessage();
  await new Promise(resolve => setTimeout(resolve, 40));
  receiver.start(second);
  await waitFor(() => receiver.getStatus().state === 'waiting');
  receiver.markMessage();
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(receiver.getStatus().state, 'connected');
  receiver.close();
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(receiver.getStatus().state, 'disabled');
  assert.equal(receiver.getStatus().connected, false);
});
