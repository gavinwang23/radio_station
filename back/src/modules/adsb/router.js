import { Router } from 'express';
import { sendData } from '../../lib/response.js';
import { normalizeIcao } from './catalog-repository.js';

export function createAdsbRouter({ catalogRepository, snapshotService, liveService }) {
  const router = Router();
  router.get('/source', async (req, res) => sendData(res, await liveService.getSource()));
  router.put('/source', async (req, res) => sendData(res, await liveService.saveSource(req.body)));
  router.get('/snapshot', async (req, res) => sendData(res, await snapshotService.snapshot()));
  router.get('/catalog/schema', async (req, res) => sendData(res, await catalogRepository.schema()));
  router.get('/catalog/:icao', async (req, res) => sendData(res, await catalogRepository.lookup(normalizeIcao(req.params.icao))));
  return router;
}
