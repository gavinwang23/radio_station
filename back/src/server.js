import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createRealtimeHub } from './realtime/hub.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export function startServer(config = loadConfig()) {
  const app = createApp({ config });
  const server = app.listen(config.server.port, config.server.host);
  const liveService = app.locals.liveAdsbService;
  const realtime = createRealtimeHub({ server, sourceService: liveService, allowedOrigins: config.server.corsOrigins });
  server.once('listening', () => {
    console.log(`Radio Station API listening at http://${config.server.host}:${server.address().port}`);
    liveService.initialize().catch(() => console.error('接收源初始化失败，请检查数据库连接和接入配置。'));
  });
  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    console.log(`Closing Radio Station API (${signal})`);
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
    deadline.unref();
    try {
      liveService.close();
      await realtime.close();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await app.locals.database.close();
      clearTimeout(deadline);
      process.exitCode = 0;
    } catch { clearTimeout(deadline); process.exitCode = 1; }
  }
  const onSigInt = () => { void shutdown('SIGINT'); };
  const onSigTerm = () => { void shutdown('SIGTERM'); };
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);
  server.on('error', error => {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    liveService.close();
    void realtime.close();
    if (error.code === 'EADDRINUSE') {
      console.error(`无法启动 API：端口 ${config.server.port} 已被占用（EADDRINUSE）。请关闭占用程序，或修改 back/.env 中的 PORT。`);
    } else {
      console.error(`API server could not listen at ${config.server.host}:${config.server.port} (${error.code || 'SERVER_ERROR'})`);
    }
    process.exitCode = 1;
  });
  return { app, server, realtime, shutdown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { startServer(); }
  catch (error) { console.error(`Invalid backend configuration: ${error.message}`); process.exitCode = 1; }
}
