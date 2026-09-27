import { AppError } from '../../lib/errors.js';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
function normalizeSnapshot(input) {
  const snapshot = Array.isArray(input) ? { aircraft: input } : input;
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.aircraft)) throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver returned an invalid aircraft snapshot');
  if (snapshot.now !== undefined && (typeof snapshot.now !== 'number' || !Number.isFinite(snapshot.now))) throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver returned an invalid aircraft snapshot');
  for (const aircraft of snapshot.aircraft) {
    if (!aircraft || typeof aircraft !== 'object' || Array.isArray(aircraft) || typeof aircraft.hex !== 'string' || !/^~?[0-9a-f]{6}$/i.test(aircraft.hex)) throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver returned an invalid aircraft snapshot');
    for (const [field, min, max] of [['lat', -90, 90], ['lon', -180, 180]]) {
      if (aircraft[field] !== undefined && (typeof aircraft[field] !== 'number' || !Number.isFinite(aircraft[field]) || aircraft[field] < min || aircraft[field] > max)) throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver returned an invalid aircraft snapshot');
    }
  }
  return snapshot;
}

export function createSnapshotService({ config, fetchImpl = fetch }) {
  return {
    status: () => config.adsb.sourceUrl ? 'configured' : 'unconfigured',
    async snapshot() {
      if (!config.adsb.sourceUrl) throw new AppError(503, 'ADSB_SOURCE_UNCONFIGURED', 'ADS-B receiver source is not configured');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.adsb.sourceTimeoutMs);
      timer.unref?.();
      try {
        const response = await fetchImpl(config.adsb.sourceUrl, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
        if (!response.ok) throw new AppError(502, 'ADSB_SOURCE_UNAVAILABLE', 'ADS-B receiver is unavailable');
        if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver snapshot is too large');
        const reader = response.body?.getReader();
        let payload;
        if (reader) {
          let bytes = 0;
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver snapshot is too large'); }
            chunks.push(Buffer.from(value));
          }
          payload = Buffer.concat(chunks).toString('utf8');
        } else payload = await response.text();
        let parsed;
        try { parsed = JSON.parse(payload); } catch { throw new AppError(502, 'ADSB_SOURCE_INVALID', 'Receiver returned invalid JSON'); }
        return normalizeSnapshot(parsed);
      } catch (error) {
        if (controller.signal.aborted) throw new AppError(504, 'ADSB_SOURCE_TIMEOUT', 'ADS-B receiver request timed out');
        if (error instanceof AppError) throw error;
        throw new AppError(502, 'ADSB_SOURCE_UNAVAILABLE', 'ADS-B receiver is unavailable');
      } finally { clearTimeout(timer); }
    },
  };
}
