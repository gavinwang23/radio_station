import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { AppError, errorHandler } from './lib/errors.js';
import { requestId } from './lib/request-id.js';
import { sendData } from './lib/response.js';
import { ModuleRegistry } from './modules/registry.js';
import { createCatalogRepository } from './modules/adsb/catalog-repository.js';
import { createSourceRepository } from './modules/sources/repository.js';
import { createLiveAdsbService } from './modules/adsb/live-service.js';
import { createAdsbRouter } from './modules/adsb/router.js';
import { createMapRouter } from './modules/maps/router.js';
import { aisModule } from './modules/ais/index.js';
import { sstvModule } from './modules/sstv/index.js';
import { weatherModule } from './modules/weather/index.js';
import { satellitesModule } from './modules/satellites/index.js';

export function createApp({ config = loadConfig(), database = createDatabase(config.database), fetchImpl = fetch, catalogRepository = createCatalogRepository({ config, database }), liveService = createLiveAdsbService({ repository: createSourceRepository({ database }) }), snapshotService, modules = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId, helmet());
  app.use(cors({ origin(origin, callback) { callback(null, !origin || config.server.corsOrigins.includes(origin)); } }));
  app.use(express.json({ limit: '64kb' }));

  const snapshots = snapshotService || {
    status: () => {
      const state = liveService.getStatus().state;
      return ['unconfigured', 'disabled'].includes(state) ? 'unconfigured' : state === 'error' ? 'unavailable' : 'configured';
    },
    snapshot: async () => {
      const status = liveService.getStatus();
      if (['unconfigured', 'disabled'].includes(status.state)) throw new AppError(503, 'ADSB_SOURCE_UNCONFIGURED', 'ADS-B receiver source is not configured');
      if (!status.connected) throw new AppError(503, 'ADSB_SOURCE_UNAVAILABLE', 'ADS-B receiver is unavailable');
      return liveService.snapshot();
    },
  };

  const registry = new ModuleRegistry();
  const overrides = new Map(modules.map(module => [module.id, module]));
  registry.register({
    id: 'adsb', label: 'ADS-B', kind: 'positions',
    status: snapshots.status,
    router: createAdsbRouter({ catalogRepository, snapshotService: snapshots, liveService }),
    endpoints: ['/api/v1/adsb/source', '/api/v1/adsb/snapshot', '/api/v1/adsb/catalog/schema', '/api/v1/adsb/catalog/:icao', '/api/v1/stream'],
    ...overrides.get('adsb'),
  });
  for (const module of [aisModule, sstvModule, weatherModule, satellitesModule]) registry.register({ ...module, ...overrides.get(module.id) });
  for (const module of modules) if (!['adsb', 'ais', 'sstv', 'weather', 'satellites'].includes(module.id)) registry.register(module);
  app.get('/api/v1/health', (req, res) => sendData(res, { status: 'ok', service: 'radio-station', uptimeSeconds: Math.floor(process.uptime()) }));
  app.get('/api/v1/modules', async (req, res) => sendData(res, await registry.list()));
  app.get('/api/v1/database/status', async (req, res) => sendData(res, await database.status()));
  registry.mount(app);
  app.use('/api/v1/maps', createMapRouter({ config, fetchImpl }));
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Route was not found')));
  app.use(errorHandler);
  app.locals.database = database;
  app.locals.moduleRegistry = registry;
  app.locals.liveAdsbService = liveService;
  return app;
}
